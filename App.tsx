
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Plus, Upload, History, Trash2, ArrowRight, Play, CheckCircle, 
  Search, Barcode, BrainCircuit, Scale, AlertTriangle, FileText, Info,
  FastForward, Download, X, List, BarChart3, CheckSquare, Clock,
  Calendar, Hash, Weight
} from 'lucide-react';
import { Bale, Session, ViewState, SessionConfig } from './types';
import { Button, Card, Input, Label } from './components/UI';
import { Scanner } from './components/Scanner';
import { saveSession, getAllSessions, deleteSession } from './services/db';
import { analyzeCottonQuality } from './services/geminiService';

// External libraries assumed loaded via CDN or available globally
declare const XLSX: any;
declare const Fuse: any;

export default function App() {
  // --- Global State ---
  const [view, setView] = useState<ViewState>('HOME');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  
  // --- Setup State ---
  const [setupConfig, setSetupConfig] = useState<SessionConfig>({
    startMillLot: '',
    startMillBale: 1,
    currentMillBale: 1,
  });
  const [excelData, setExcelData] = useState<any[]>([]);
  const [excelHeaders, setExcelHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState({ searchColumn: '', value1: '', value2: '' });

  // --- Workbench State ---
  const [scanMode, setScanMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Bale[]>([]);
  const [selectedBale, setSelectedBale] = useState<Bale | null>(null);
  const [weightInput, setWeightInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  
  // Report & History State
  const [showReport, setShowReport] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [reportStep, setReportStep] = useState<'SELECT' | 'VIEW'>('SELECT');
  const [reportSelection, setReportSelection] = useState<string[]>([]);

  // --- Initialization ---
  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const s = await getAllSessions();
      setSessions(s);
    } catch (e) {
      console.error("Failed to load sessions", e);
    }
  };

  // --- Handlers: Home ---
  const handleStartManual = () => {
    setSetupConfig({ startMillLot: '', startMillBale: 1, currentMillBale: 1 });
    setView('SETUP_MANUAL');
  };

  const handleStartExcel = () => {
    setSetupConfig({ startMillLot: '', startMillBale: 1, currentMillBale: 1 });
    setView('SETUP_EXCEL');
  };

  const handleDeleteSession = async (id: string) => {
    if (confirm("Delete this session permanently?")) {
      await deleteSession(id);
      loadSessions();
    }
  };

  const handleResumeSession = (session: Session) => {
    setCurrentSession(session);
    
    // Auto-resume manual sessions to the next sequential bale
    if (session.type === 'manual') {
        const nextId = `${session.config.startMillLot}-${session.config.currentMillBale}`;
        const nextBale: Bale = {
            id: nextId,
            originalId: nextId,
            mappedValues: {},
            millLot: session.config.startMillLot,
            millBaleNumber: session.config.currentMillBale,
            weight: null,
            status: 'pending'
        };
        setSelectedBale(nextBale);
        setWeightInput(''); 
        setAnalysisResult(null);
    } else {
        setSelectedBale(null);
    }

    setView('WORKBENCH');
  };

  const handleExportSession = (session: Session) => {
    if (!session || session.bales.length === 0) {
        alert("No data to export.");
        return;
    }

    // Flatten data for export
    const exportData = session.bales.map(b => {
        return {
            'Bale ID': b.id,
            'Mill Lot': b.millLot,
            'Mill Bale #': b.millBaleNumber,
            'Weight': b.weight,
            'Status': b.status,
            'Scanned At': b.scannedAt,
            'AI Analysis': b.aiAnalysis,
            ...b.mappedValues
        };
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CottonLog Data");
    const safeName = session.name.replace(/[^a-z0-9]/gi, '_');
    XLSX.writeFile(wb, `${safeName}_Export.xlsx`);
  };

  // --- Handlers: Excel ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws);
      
      if (data.length > 0) {
        setExcelData(data);
        setExcelHeaders(Object.keys(data[0]));
        setView('MAPPING');
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleNativeFileUpload = async () => {
    try {
      // @ts-ignore
      const [fileHandle] = await window.showOpenFilePicker({
        types: [{ description: 'Excel Files', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx', '.xls'] } }],
      });
      const file = await fileHandle.getFile();
      // Reuse logic
      const reader = new FileReader();
      reader.onload = (evt) => {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);
        if (data.length > 0) {
          setExcelData(data);
          setExcelHeaders(Object.keys(data[0]));
          setView('MAPPING');
        }
      };
      reader.readAsBinaryString(file);

    } catch (err) {
      console.log("Native FS API cancelled or failed, falling back to input");
      document.getElementById('hidden-file-input')?.click();
    }
  };

  const finishMapping = () => {
    if (!mapping.searchColumn || !setupConfig.startMillLot) {
      alert("Please map the search column and define a Lot #");
      return;
    }

    // Convert Excel Data to Bales
    const bales: Bale[] = excelData.map(row => ({
      id: String(row[mapping.searchColumn]),
      originalId: String(row[mapping.searchColumn]),
      mappedValues: {
        [mapping.value1]: row[mapping.value1],
        [mapping.value2]: row[mapping.value2]
      },
      millLot: '', // Assigned on process
      millBaleNumber: 0, // Assigned on process
      weight: null,
      status: 'pending'
    }));

    const newSession: Session = {
      id: crypto.randomUUID(),
      name: `Lot ${setupConfig.startMillLot} (${new Date().toLocaleDateString()})`,
      createdAt: new Date().toISOString(),
      type: 'excel',
      config: {
        ...setupConfig,
        columnMapping: {
            searchColumn: mapping.searchColumn,
            value1: mapping.value1,
            value2: mapping.value2,
            value1Name: mapping.value1,
            value2Name: mapping.value2
        }
      },
      bales: bales,
      status: 'active'
    };

    saveSession(newSession);
    setCurrentSession(newSession);
    setView('WORKBENCH');
  };

  // --- Handlers: Manual Setup ---
  const finishManualSetup = () => {
      if (!setupConfig.startMillLot) return;
      const newSession: Session = {
          id: crypto.randomUUID(),
          name: `Manual Lot ${setupConfig.startMillLot}`,
          createdAt: new Date().toISOString(),
          type: 'manual',
          config: setupConfig,
          bales: [],
          status: 'active'
      };
      saveSession(newSession);
      setCurrentSession(newSession);
      
      // Auto-start first bale for flow
      const firstId = `${setupConfig.startMillLot}-${setupConfig.startMillBale}`;
      const firstBale: Bale = {
          id: firstId,
          originalId: firstId,
          mappedValues: {},
          millLot: setupConfig.startMillLot,
          millBaleNumber: setupConfig.startMillBale,
          weight: null,
          status: 'pending'
      };
      setSelectedBale(firstBale);
      setView('WORKBENCH');
  };

  // --- Handlers: Workbench ---
  const handleSearch = (term: string) => {
    setSearchQuery(term);
    if (!currentSession) return;

    if (currentSession.type === 'manual') {
        return;
    }

    // Fuzzy search for Excel sessions
    if (!term) {
        setSearchResults([]);
        return;
    }

    const options = {
        keys: ['id'],
        threshold: 0.3
    };
    const fuse = new Fuse(currentSession.bales, options);
    const result = fuse.search(term);
    // Return all matches, slicing happens in render
    setSearchResults(result.map((r: any) => r.item));
  };

  const handleSelectBale = (bale: Bale) => {
    setSelectedBale(bale);
    setSearchQuery('');
    setSearchResults([]);
    setWeightInput(bale.weight ? String(bale.weight) : '');
    setAnalysisResult(bale.aiAnalysis || null);
  };

  const handleManualNewBale = () => {
      const tempBale: Bale = {
          id: searchQuery || `MANUAL-${Date.now()}`,
          originalId: searchQuery || `MANUAL-${Date.now()}`,
          mappedValues: {},
          millLot: currentSession!.config.startMillLot,
          millBaleNumber: currentSession!.config.currentMillBale,
          weight: null,
          status: 'pending'
      };
      setSelectedBale(tempBale);
      setSearchQuery('');
  };

  const startSequentialEntry = () => {
      if (!currentSession) return;
      const nextId = `${currentSession.config.startMillLot}-${currentSession.config.currentMillBale}`;
      const nextBale: Bale = {
          id: nextId,
          originalId: nextId,
          mappedValues: {},
          millLot: currentSession.config.startMillLot,
          millBaleNumber: currentSession.config.currentMillBale,
          weight: null,
          status: 'pending'
      };
      setSelectedBale(nextBale);
  };

  const handleAnalyze = async () => {
    if (!selectedBale || !currentSession) return;
    setIsAnalyzing(true);
    
    let mic = 'N/A';
    let str = 'N/A';

    if (currentSession.config.columnMapping) {
        mic = selectedBale.mappedValues[currentSession.config.columnMapping.value1] || 'N/A';
        str = selectedBale.mappedValues[currentSession.config.columnMapping.value2] || 'N/A';
    }

    const result = await analyzeCottonQuality(mic, str, selectedBale.mappedValues);
    setAnalysisResult(result);
    setIsAnalyzing(false);
  };

  const handleSaveBale = async () => {
    if (!selectedBale || !currentSession || !weightInput) return;

    const weight = parseFloat(weightInput);
    if (isNaN(weight)) return;

    const updatedConfig = {
        ...currentSession.config,
        currentMillBale: currentSession.config.currentMillBale + 1
    };

    const updatedBale: Bale = {
        ...selectedBale,
        weight: weight,
        millLot: updatedConfig.startMillLot,
        millBaleNumber: currentSession.config.currentMillBale,
        aiAnalysis: analysisResult || undefined,
        status: 'completed',
        scannedAt: new Date().toISOString()
    };

    let updatedBales = [...currentSession.bales];
    
    if (currentSession.type === 'excel') {
        const index = updatedBales.findIndex(b => b.id === selectedBale.id);
        if (index >= 0) {
            updatedBales[index] = updatedBale;
        }
    } else {
        updatedBales.push(updatedBale);
    }

    const updatedSession = {
        ...currentSession,
        config: updatedConfig,
        bales: updatedBales
    };

    await saveSession(updatedSession);
    setCurrentSession(updatedSession);
    
    if (currentSession.type === 'manual') {
        const nextId = `${updatedConfig.startMillLot}-${updatedConfig.currentMillBale}`;
        const nextBale: Bale = {
            id: nextId,
            originalId: nextId,
            mappedValues: {},
            millLot: updatedConfig.startMillLot,
            millBaleNumber: updatedConfig.currentMillBale,
            weight: null,
            status: 'pending'
        };
        setSelectedBale(nextBale);
        setWeightInput('');
        setAnalysisResult(null);
    } else {
        setSelectedBale(null);
        setWeightInput('');
        setAnalysisResult(null);
    }
  };

  // --- Helper: Generate Stats ---
  const getColumnStats = (type: 'id' | 'value1' | 'value2') => {
    if (!currentSession) return [];
    
    let key = '';
    let isMapped = true;
    
    if (type === 'id') {
        isMapped = false;
        key = 'id';
    } else if (type === 'value1') {
        key = currentSession.config.columnMapping?.value1 || '';
    } else if (type === 'value2') {
        key = currentSession.config.columnMapping?.value2 || '';
    }
    
    if (!key && type !== 'id') return [];

    const counts = new Map<string, number>();
    currentSession.bales.forEach(b => {
        let val: any;
        if (type === 'id') {
            val = b.id;
        } else {
            val = b.mappedValues[key];
        }
        
        const valStr = val !== undefined && val !== null ? String(val).trim() : '(Empty)';
        counts.set(valStr, (counts.get(valStr) || 0) + 1);
    });

    return Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => a.count - b.count); // Ascending: Smallest to Largest
  };

  // --- Derived State ---
  const totalWeight = currentSession?.bales.reduce((sum, b) => sum + (b.weight || 0), 0) || 0;
  const duplicateCount = currentSession?.bales.filter((b, i, a) => a.findIndex(b2 => b2.id === b.id && b2.weight) !== i).length || 0;

  // --- Views ---

  const renderReportModal = () => {
    if (!showReport || !currentSession) return null;

    if (reportStep === 'SELECT') {
        return (
            <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-slate-800 w-full max-w-md rounded-2xl shadow-2xl flex flex-col border border-slate-700 animate-in fade-in zoom-in-95 duration-200">
                    <div className="p-6 border-b border-slate-700 flex justify-between items-center">
                         <div>
                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                <CheckSquare className="text-blue-400" size={20} /> Select Columns
                            </h2>
                            <p className="text-slate-400 text-sm">Choose columns to analyze for duplicates.</p>
                         </div>
                         <button onClick={() => setShowReport(false)} className="text-slate-400 hover:text-white"><X size={20}/></button>
                    </div>

                    <div className="p-6 space-y-3">
                         <label className={`flex items-start gap-4 p-4 rounded-xl border cursor-pointer transition-all ${reportSelection.includes('id') ? 'bg-blue-900/20 border-blue-500' : 'bg-slate-900 border-slate-700 hover:border-slate-500'}`}>
                            <input 
                                type="checkbox" 
                                className="mt-1 w-5 h-5 rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500 accent-blue-500"
                                checked={reportSelection.includes('id')}
                                onChange={(e) => {
                                    if(e.target.checked) setReportSelection([...reportSelection, 'id']);
                                    else setReportSelection(reportSelection.filter(x => x !== 'id'));
                                }}
                            />
                            <div>
                                <div className="font-bold text-white">Barcode ID</div>
                                <div className="text-xs text-slate-400 mt-1">Column: {currentSession.config.columnMapping?.searchColumn}</div>
                            </div>
                         </label>

                         {currentSession.config.columnMapping?.value1 && (
                             <label className={`flex items-start gap-4 p-4 rounded-xl border cursor-pointer transition-all ${reportSelection.includes('value1') ? 'bg-blue-900/20 border-blue-500' : 'bg-slate-900 border-slate-700 hover:border-slate-500'}`}>
                                <input 
                                    type="checkbox" 
                                    className="mt-1 w-5 h-5 rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500 accent-blue-500"
                                    checked={reportSelection.includes('value1')}
                                    onChange={(e) => {
                                        if(e.target.checked) setReportSelection([...reportSelection, 'value1']);
                                        else setReportSelection(reportSelection.filter(x => x !== 'value1'));
                                    }}
                                />
                                <div>
                                    <div className="font-bold text-white">Value 1</div>
                                    <div className="text-xs text-slate-400 mt-1">Column: {currentSession.config.columnMapping.value1}</div>
                                </div>
                             </label>
                         )}

                         {currentSession.config.columnMapping?.value2 && (
                             <label className={`flex items-start gap-4 p-4 rounded-xl border cursor-pointer transition-all ${reportSelection.includes('value2') ? 'bg-blue-900/20 border-blue-500' : 'bg-slate-900 border-slate-700 hover:border-slate-500'}`}>
                                <input 
                                    type="checkbox" 
                                    className="mt-1 w-5 h-5 rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500 accent-blue-500"
                                    checked={reportSelection.includes('value2')}
                                    onChange={(e) => {
                                        if(e.target.checked) setReportSelection([...reportSelection, 'value2']);
                                        else setReportSelection(reportSelection.filter(x => x !== 'value2'));
                                    }}
                                />
                                <div>
                                    <div className="font-bold text-white">Value 2</div>
                                    <div className="text-xs text-slate-400 mt-1">Column: {currentSession.config.columnMapping.value2}</div>
                                </div>
                             </label>
                         )}
                    </div>

                    <div className="p-4 bg-slate-900/50 border-t border-slate-700 rounded-b-2xl flex justify-end gap-3">
                         <Button variant="ghost" onClick={() => setShowReport(false)}>Cancel</Button>
                         <Button onClick={() => setReportStep('VIEW')} disabled={reportSelection.length === 0}>
                            Analyze Selected
                         </Button>
                    </div>
                </div>
            </div>
        );
    }

    // VIEW STEP
    const idStats = reportSelection.includes('id') ? getColumnStats('id') : null;
    const v1Stats = reportSelection.includes('value1') ? getColumnStats('value1') : null;
    const v2Stats = reportSelection.includes('value2') ? getColumnStats('value2') : null;

    const renderStatColumn = (title: string, stats: {value: string, count: number}[]) => (
        <div className="flex-1 min-w-[250px] bg-slate-900 rounded-lg p-4 border border-slate-700 max-h-[60vh] overflow-y-auto">
            <h4 className="font-bold text-slate-300 mb-3 sticky top-0 bg-slate-900 pb-2 border-b border-slate-700 flex justify-between">
                <span>{title}</span>
                <span className="text-xs font-normal text-slate-500">Count (Low-High)</span>
            </h4>
            <div className="space-y-1">
                {stats.length === 0 && <p className="text-slate-500 text-sm italic">No data</p>}
                {stats.map((s, idx) => (
                    <div key={idx} className="flex justify-between text-sm py-1 border-b border-slate-800 last:border-0 hover:bg-slate-800 px-2 rounded">
                        <span className="font-mono text-slate-300">{s.value}</span>
                        <span className={`font-bold ${s.count > 1 ? 'text-amber-500' : 'text-slate-600'}`}>
                            {s.count}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-800 w-full max-w-6xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col border border-slate-700 animate-in fade-in zoom-in-95 duration-200">
                <div className="p-6 border-b border-slate-700 flex justify-between items-center">
                    <div>
                        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                            <BarChart3 className="text-amber-500" /> Value Distribution & Duplicates
                        </h2>
                        <p className="text-slate-400 text-sm">Frequency count of unique values (Ascending Order)</p>
                    </div>
                    <button onClick={() => setShowReport(false)} className="p-2 hover:bg-slate-700 rounded-full text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>
                
                <div className="p-6 flex-1 overflow-auto">
                     <div className="flex flex-wrap gap-4">
                        {idStats && renderStatColumn(`ID / ${currentSession.config.columnMapping?.searchColumn || 'Barcode'}`, idStats)}
                        {v1Stats && currentSession.config.columnMapping?.value1 && 
                            renderStatColumn(currentSession.config.columnMapping.value1, v1Stats)
                        }
                        {v2Stats && currentSession.config.columnMapping?.value2 && 
                            renderStatColumn(currentSession.config.columnMapping.value2, v2Stats)
                        }
                     </div>
                </div>

                <div className="p-4 border-t border-slate-700 bg-slate-900/50 rounded-b-2xl flex justify-between items-center">
                    <Button variant="ghost" onClick={() => setReportStep('SELECT')}>Back to Selection</Button>
                    <Button variant="secondary" onClick={() => setShowReport(false)}>Close Report</Button>
                </div>
            </div>
        </div>
    );
  };

  const renderHistoryModal = () => {
    if (!showHistory || !currentSession) return null;

    const completedBales = currentSession.bales
        .filter(b => b.status === 'completed')
        .sort((a, b) => (b.millBaleNumber || 0) - (a.millBaleNumber || 0));

    return (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-800 w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col border border-slate-700 animate-in fade-in zoom-in-95 duration-200">
                <div className="p-6 border-b border-slate-700 flex justify-between items-center">
                    <div>
                        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                            <Clock className="text-blue-400" /> Session History
                        </h2>
                        <p className="text-slate-400 text-sm">Processed bales in current session (Last processed on top)</p>
                    </div>
                    <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-slate-700 rounded-full text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>
                
                <div className="flex-1 overflow-auto p-0">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-900 sticky top-0 text-slate-400 text-sm uppercase tracking-wider font-medium z-10 shadow-sm">
                            <tr>
                                <th className="p-4 border-b border-slate-700">Mill Bale #</th>
                                <th className="p-4 border-b border-slate-700">ID / Barcode</th>
                                <th className="p-4 border-b border-slate-700 text-right">Weight</th>
                                <th className="p-4 border-b border-slate-700 text-right">Time</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800 text-slate-300">
                            {completedBales.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="p-8 text-center text-slate-500 italic">No bales processed yet.</td>
                                </tr>
                            )}
                            {completedBales.map(b => (
                                <tr key={b.id} className="hover:bg-slate-700/50 transition-colors">
                                    <td className="p-4 font-mono text-amber-500 font-bold">#{b.millBaleNumber}</td>
                                    <td className="p-4 font-medium text-white">{b.id}</td>
                                    <td className="p-4 text-right font-mono text-white">{b.weight}</td>
                                    <td className="p-4 text-right text-sm text-slate-500">
                                        {b.scannedAt ? new Date(b.scannedAt).toLocaleTimeString() : '-'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="p-4 border-t border-slate-700 bg-slate-900/50 rounded-b-2xl flex justify-between items-center">
                     <div className="text-slate-500 text-sm">Total: <span className="text-white font-bold">{completedBales.length}</span></div>
                    <Button variant="ghost" onClick={() => setShowHistory(false)}>Close</Button>
                </div>
            </div>
        </div>
    );
  };

  const renderHome = () => {
    const manualSessions = sessions.filter(s => s.type === 'manual');
    const excelSessions = sessions.filter(s => s.type === 'excel');

    const getLastActivity = (s: Session) => {
        const completed = s.bales.filter(b => b.status === 'completed');
        if (completed.length === 0) return null;
        const last = [...completed].sort((a,b) => (new Date(b.scannedAt || 0).getTime() - new Date(a.scannedAt || 0).getTime()))[0];
        return last;
    };

    const calculateSessionWeight = (s: Session) => {
        return s.bales.reduce((acc, b) => acc + (b.weight || 0), 0);
    };

    const renderSessionList = (sessionList: Session[], type: 'manual' | 'excel') => {
        if (sessionList.length === 0) {
            return <p className="text-slate-500 italic p-6 border border-dashed border-slate-700 rounded-xl text-center">No {type} sessions found.</p>;
        }

        return (
            <div className="space-y-4">
                {sessionList.map(session => {
                    const last = getLastActivity(session);
                    const totalWeight = calculateSessionWeight(session);
                    const completedCount = session.bales.filter(b => b.status === 'completed').length;
                    const totalCount = session.type === 'excel' ? session.bales.length : completedCount;
                    const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
                    const accentColor = type === 'manual' ? 'blue' : 'amber';
                    const borderClass = type === 'manual' ? 'border-l-blue-500' : 'border-l-amber-500';

                    return (
                        <Card key={session.id} className={`group p-0 overflow-hidden border-l-4 ${borderClass} hover:bg-slate-750 transition-all shadow-lg`}>
                            <div className="p-5">
                                <div className="flex flex-col md:flex-row justify-between gap-6">
                                    <div className="flex-1 space-y-4">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <h3 className="font-bold text-xl text-white group-hover:text-blue-400 transition-colors">{session.name}</h3>
                                                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded tracking-tighter ${type === 'manual' ? 'bg-blue-900/50 text-blue-400' : 'bg-amber-900/50 text-amber-400'}`}>
                                                        {type}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-3 text-xs text-slate-500">
                                                    <span className="flex items-center gap-1"><Calendar size={12}/> {new Date(session.createdAt).toLocaleDateString()}</span>
                                                    <span className="flex items-center gap-1"><Clock size={12}/> {new Date(session.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                                </div>
                                            </div>
                                            {type === 'excel' && (
                                                <div className="text-right">
                                                    <span className="text-2xl font-bold text-slate-300">{progress}%</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Statistics Grid */}
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 bg-slate-900/50 p-3 rounded-lg border border-slate-700/50">
                                            <div className="flex flex-col">
                                                <span className="text-[10px] uppercase text-slate-500 font-bold tracking-widest flex items-center gap-1">
                                                    <Hash size={10} /> Records
                                                </span>
                                                <span className="text-lg font-mono font-bold text-white">
                                                    {completedCount}{type === 'excel' ? ` / ${totalCount}` : ''}
                                                </span>
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-[10px] uppercase text-slate-500 font-bold tracking-widest flex items-center gap-1">
                                                    <Weight size={10} /> Weighted
                                                </span>
                                                <span className="text-lg font-mono font-bold text-white">
                                                    {totalWeight.toLocaleString()} <span className="text-[10px] text-slate-500">LBS</span>
                                                </span>
                                            </div>
                                            <div className="hidden sm:flex flex-col">
                                                <span className="text-[10px] uppercase text-slate-500 font-bold tracking-widest flex items-center gap-1">
                                                    <Play size={10} /> Last Active
                                                </span>
                                                <span className="text-sm font-medium text-slate-300 truncate">
                                                    {last ? `Bale #${last.millBaleNumber}` : 'New Session'}
                                                </span>
                                            </div>
                                        </div>

                                        {type === 'excel' && (
                                            <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                                <div className={`h-full bg-gradient-to-r ${accentColor === 'blue' ? 'from-blue-600 to-blue-400' : 'from-amber-600 to-amber-400'} transition-all duration-700 ease-out`} style={{ width: `${progress}%` }}></div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex flex-row md:flex-col items-center md:items-end justify-between md:justify-center gap-3 border-t md:border-t-0 md:border-l border-slate-700/50 pt-4 md:pt-0 md:pl-6">
                                        <div className="flex gap-2 w-full md:w-auto">
                                            <Button variant="ghost" onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id); }} title="Delete Session" className="text-slate-500 hover:text-red-400 hover:bg-red-950/20">
                                                <Trash2 size={18} />
                                            </Button>
                                            <Button variant="secondary" onClick={(e) => { e.stopPropagation(); handleExportSession(session); }} title="Download Excel" className="hidden sm:flex">
                                                <Download size={18} />
                                            </Button>
                                            <Button 
                                                variant="primary" 
                                                className={`flex-1 md:flex-none font-bold tracking-wide shadow-lg ${type === 'manual' ? 'bg-blue-600 hover:bg-blue-500' : 'bg-amber-600 hover:bg-amber-500'}`} 
                                                onClick={() => handleResumeSession(session)}
                                            >
                                                {type === 'manual' ? 'RESUME LOT' : 'WORK LOT'}
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </Card>
                    );
                })}
            </div>
        );
    };

    return (
    <div className="max-w-5xl mx-auto p-4 space-y-10 pb-20 pt-6">
      <header className="flex justify-between items-end mb-8 border-b border-slate-800 pb-6">
        <div>
            <div className="flex items-center gap-3 mb-1">
                <div className="p-2 bg-blue-600 rounded-lg shadow-lg shadow-blue-900/40">
                    <Scale className="text-white" size={24} />
                </div>
                <h1 className="text-4xl font-black text-white tracking-tighter italic">COTTONLOG</h1>
            </div>
            <p className="text-slate-500 font-medium uppercase tracking-[0.2em] text-xs">Professional Bale Inventory Control</p>
        </div>
        <button onClick={() => alert("Local-First Architecture: Data is stored in your browser's IndexedDB. No cloud upload happens unless configured.")} className="p-2 text-slate-500 hover:text-blue-400 transition-colors">
            <Info size={24} />
        </button>
      </header>

      {/* Main Control Panel */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <button onClick={handleStartManual} className="group relative p-8 bg-slate-800 rounded-2xl border border-slate-700 hover:border-blue-500 transition-all flex items-center gap-6 shadow-xl overflow-hidden active:scale-[0.98]">
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                <Plus size={120} />
            </div>
            <div className="p-5 rounded-2xl bg-slate-900 group-hover:bg-blue-600 text-blue-400 group-hover:text-white transition-all shadow-inner">
                <Plus size={36} />
            </div>
            <div className="text-left">
                <h3 className="font-black text-xl text-white uppercase tracking-tight">Manual Lot</h3>
                <p className="text-slate-400 text-sm">Create a fresh lot from scratch.</p>
            </div>
        </button>
        <button onClick={handleStartExcel} className="group relative p-8 bg-slate-800 rounded-2xl border border-slate-700 hover:border-amber-500 transition-all flex items-center gap-6 shadow-xl overflow-hidden active:scale-[0.98]">
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                <Upload size={120} />
            </div>
            <div className="p-5 rounded-2xl bg-slate-900 group-hover:bg-amber-600 text-amber-500 group-hover:text-white transition-all shadow-inner">
                <Upload size={36} />
            </div>
            <div className="text-left">
                <h3 className="font-black text-xl text-white uppercase tracking-tight">Import Excel</h3>
                <p className="text-slate-400 text-sm">Link existing HVI inventory data.</p>
            </div>
        </button>
      </section>

      {/* Active Workflows Section */}
      <section>
        <div className="flex items-center justify-between mb-6">
            <h2 className="text-xs font-black uppercase tracking-[0.3em] text-slate-500 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                Active Manual Workflows
            </h2>
        </div>
        {renderSessionList(manualSessions, 'manual')}
      </section>

      {/* Inventory Lots Section */}
      <section>
        <div className="flex items-center justify-between mb-6">
            <h2 className="text-xs font-black uppercase tracking-[0.3em] text-slate-500 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                Inventory Lot Archives
            </h2>
        </div>
        {renderSessionList(excelSessions, 'excel')}
      </section>
    </div>
  );
  };

  const renderMapping = () => {
    // Helper to get preview
    const getPreview = (header: string) => {
        if (!excelData || excelData.length === 0) return '';
        const val = excelData[0][header];
        return val !== undefined && val !== null ? `(Ex: ${val})` : '(Empty)';
    };

    return (
    <div className="max-w-2xl mx-auto p-4">
        <Card className="p-6 space-y-6">
            <h2 className="text-2xl font-bold">Map Columns</h2>
            <p className="text-slate-400">Match your Excel headers to the system requirements.</p>
            
            <div className="grid gap-4">
                <div>
                    <Label>Lot Number (Required)</Label>
                    <Input 
                        value={setupConfig.startMillLot}
                        onChange={(e) => setSetupConfig({...setupConfig, startMillLot: e.target.value})}
                        placeholder="e.g. A-100"
                    />
                </div>
                <div>
                    <Label>Starting Bale #</Label>
                    <Input 
                        type="number"
                        value={setupConfig.startMillBale}
                        onChange={(e) => setSetupConfig({...setupConfig, startMillBale: parseInt(e.target.value)})}
                    />
                </div>

                <div className="border-t border-slate-700 pt-4 mt-4">
                    <Label>Barcode ID Column (Required)</Label>
                    <select 
                        className="w-full bg-slate-900 border border-slate-700 p-2 rounded text-white"
                        onChange={(e) => setMapping({...mapping, searchColumn: e.target.value})}
                        value={mapping.searchColumn}
                    >
                        <option value="">Select Column...</option>
                        {excelHeaders.map(h => (
                            <option key={h} value={h}>
                                {h} {getPreview(h)}
                            </option>
                        ))}
                    </select>
                </div>

                <div>
                    <Label>Quality Value 1 (e.g. Mic)</Label>
                    <select 
                        className="w-full bg-slate-900 border border-slate-700 p-2 rounded text-white"
                        onChange={(e) => setMapping({...mapping, value1: e.target.value})}
                        value={mapping.value1}
                    >
                        <option value="">Select Column...</option>
                        {excelHeaders.map(h => (
                            <option key={h} value={h}>
                                {h} {getPreview(h)}
                            </option>
                        ))}
                    </select>
                </div>

                <div>
                    <Label>Quality Value 2 (e.g. Strength)</Label>
                    <select 
                        className="w-full bg-slate-900 border border-slate-700 p-2 rounded text-white"
                        onChange={(e) => setMapping({...mapping, value2: e.target.value})}
                        value={mapping.value2}
                    >
                        <option value="">Select Column...</option>
                        {excelHeaders.map(h => (
                            <option key={h} value={h}>
                                {h} {getPreview(h)}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="flex justify-between pt-4">
                <Button variant="ghost" onClick={() => setView('HOME')}>Cancel</Button>
                <Button onClick={finishMapping}>Start Session</Button>
            </div>
        </Card>
    </div>
  )};

  const renderWorkbench = () => {
      if (!currentSession) return null;

      // Scanning Frame
      if (scanMode) {
          return (
            <Scanner 
                onScan={(code) => {
                    setScanMode(false);
                    handleSearch(code);
                    // If in Excel mode, try to auto-select
                    if (currentSession.type === 'excel') {
                        const found = currentSession.bales.find(b => b.id === code);
                        if (found) handleSelectBale(found);
                        else {
                            alert("Bale not found in inventory.");
                            setSearchQuery(code);
                        }
                    } else {
                        // Manual Mode
                        setSearchQuery(code);
                        handleManualNewBale();
                    }
                }}
                onClose={() => setScanMode(false)}
            />
          );
      }

      // Workbench UI
      return (
        <div className="min-h-screen flex flex-col relative">
            {/* Modal Overlay */}
            {renderReportModal()}
            {renderHistoryModal()}

            {/* Header / Sticky Status */}
            <div className="bg-slate-800 border-b border-slate-700 p-4 sticky top-0 z-30 shadow-lg">
                <div className="max-w-4xl mx-auto flex justify-between items-center">
                    <div>
                        <div className="text-xs text-slate-400 uppercase tracking-wider">Current Lot</div>
                        <div className="text-xl font-bold text-white">{currentSession.config.startMillLot}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-slate-400 uppercase tracking-wider">Next Bale #</div>
                        <div className="text-2xl font-mono font-bold text-amber-500">{currentSession.config.currentMillBale}</div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" onClick={() => setShowHistory(true)} title="Session History">
                            <Clock size={20} />
                        </Button>
                        <Button variant="ghost" onClick={() => handleExportSession(currentSession)} title="Export Data">
                             <Download size={20} />
                        </Button>
                        <Button variant="ghost" onClick={() => setView('HOME')}>Exit</Button>
                    </div>
                </div>
            </div>

            <div className="flex-1 p-4 max-w-2xl mx-auto w-full space-y-6">
                
                {/* Search / Scan Area (HIDDEN if we are in Manual Loop, unless actively cancelled) */}
                {!selectedBale && (
                    <div className="space-y-4 mt-8">
                        {/* Special Prompt for Manual Resume */}
                        {currentSession.type === 'manual' && (
                            <Button 
                                onClick={startSequentialEntry} 
                                className="w-full py-8 text-xl bg-indigo-600 hover:bg-indigo-700 flex flex-col items-center gap-2"
                            >
                                <FastForward size={32} />
                                <span>Resume Sequential Entry</span>
                                <span className="text-sm font-normal text-indigo-200">
                                    Next: {currentSession.config.startMillLot}-{currentSession.config.currentMillBale}
                                </span>
                            </Button>
                        )}

                        <div className="flex gap-3">
                            <div className="relative flex-1 group">
                                <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none group-focus-within:text-blue-400 transition-colors" size={28} />
                                <Input 
                                    placeholder="Scan or Enter Bale ID..." 
                                    className="pl-16 h-20 text-2xl font-medium bg-slate-950 border-slate-700 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 transition-all shadow-inner rounded-xl"
                                    value={searchQuery}
                                    onChange={(e) => handleSearch(e.target.value)}
                                    autoFocus={!selectedBale}
                                    inputMode="numeric"
                                />
                            </div>
                            <Button onClick={() => setScanMode(true)} className="aspect-square h-20 w-20 rounded-xl flex items-center justify-center bg-slate-800 hover:bg-slate-700 border border-slate-700 shadow-lg text-blue-400">
                                <Barcode size={40} />
                            </Button>
                        </div>
                        
                        {/* Duplicate List Button - Now Below Search Box */}
                        {currentSession.type === 'excel' && (
                            <Button 
                                variant="secondary"
                                className="w-full py-3 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white"
                                onClick={() => {
                                    setReportStep('SELECT');
                                    setReportSelection([]);
                                    setShowReport(true);
                                }}
                            >
                                <List className="mr-2 h-4 w-4" /> Duplicate List / Value Distribution
                            </Button>
                        )}
                        
                        {currentSession.type === 'manual' && searchQuery && (
                             <Button onClick={handleManualNewBale} className="w-full h-16 text-lg border-dashed border-2 bg-transparent border-slate-600 hover:border-blue-500 hover:text-blue-400 text-slate-400 mt-4">
                                <Plus className="mr-2" /> Create New Entry: <span className="font-mono font-bold ml-2 text-white">{searchQuery}</span>
                             </Button>
                        )}

                        {/* Search Results Dropdown - Big & Detailed */}
                        {searchQuery && (
                            <div className="space-y-3 mt-6 animate-in fade-in slide-in-from-top-2 duration-200">
                                <div className="flex justify-between items-center px-2">
                                    <span className="text-sm font-medium text-slate-400 uppercase tracking-wider">Search Results</span>
                                    <span className="text-xs text-slate-500">{searchResults.length} Matches</span>
                                </div>
                                
                                {searchResults.slice(0, 50).map(bale => (
                                    <div 
                                        key={bale.id} 
                                        onClick={() => handleSelectBale(bale)}
                                        className="group relative p-6 bg-slate-800 rounded-xl border border-slate-700 hover:bg-slate-750 hover:border-blue-500 cursor-pointer transition-all shadow-md hover:shadow-blue-900/20 active:scale-[0.99]"
                                    >
                                        <div className="flex justify-between items-center">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-3 mb-2">
                                                     <span className="font-mono text-3xl font-bold text-white group-hover:text-blue-400 transition-colors truncate">
                                                        {bale.id}
                                                     </span>
                                                     {bale.status === 'completed' && (
                                                        <span className="bg-green-500/20 text-green-400 text-xs font-bold px-2 py-1 rounded-full border border-green-500/30 uppercase tracking-wide">
                                                            Processed
                                                        </span>
                                                     )}
                                                </div>
                                                
                                                {/* Data Display */}
                                                {currentSession.type === 'excel' && (
                                                    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                                                        {Object.entries(bale.mappedValues).map(([key, val]) => (
                                                            <div key={key} className="flex items-baseline gap-2">
                                                                <span className="text-slate-500 font-bold text-xs uppercase tracking-wider">{key}</span>
                                                                <span className="font-mono text-white text-2xl font-bold">{val}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="pl-4">
                                                <div className="h-12 w-12 rounded-full bg-slate-900 border border-slate-700 group-hover:bg-blue-600 group-hover:border-blue-500 group-hover:text-white flex items-center justify-center transition-all text-slate-500">
                                                    {bale.status === 'completed' ? <CheckCircle size={24} /> : <ArrowRight size={24} />}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                
                                {searchResults.length === 0 && currentSession.type === 'excel' && (
                                     <div className="p-12 text-center flex flex-col items-center text-slate-500 bg-slate-800/30 rounded-xl border border-dashed border-slate-700">
                                        <Search size={48} className="mb-4 opacity-20" />
                                        <p className="text-lg font-medium">No bales found matching "{searchQuery}"</p>
                                        <p className="text-sm opacity-60">Try scanning again or check your inventory file.</p>
                                     </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Bale Details / Entry Area */}
                {selectedBale && (
                    <div key={selectedBale.id} className="animate-in fade-in slide-in-from-bottom-4 duration-300 space-y-6">
                        <div className="flex items-center justify-between pb-4 border-b border-slate-700">
                             <h2 className="text-2xl font-mono font-bold">{selectedBale.id}</h2>
                             <button onClick={() => setSelectedBale(null)} className="text-slate-400 hover:text-white">Cancel</button>
                        </div>

                        {/* HVI Data Display */}
                        {currentSession.type === 'excel' && (
                            <div className="grid grid-cols-2 gap-4">
                                {Object.entries(selectedBale.mappedValues).map(([k, v]) => (
                                    <div key={k} className="bg-slate-800 p-4 rounded border border-slate-700">
                                        <div className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1">{k}</div>
                                        <div className="font-bold text-4xl text-white">{v}</div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* AI Analysis */}
                        {currentSession.type === 'excel' && (
                            <Card className="bg-gradient-to-br from-indigo-900/40 to-slate-800">
                                <div className="p-4">
                                    <div className="flex justify-between items-center mb-2">
                                        <h3 className="flex items-center gap-2 font-bold text-indigo-300">
                                            <BrainCircuit size={18} /> Quality AI
                                        </h3>
                                        {!analysisResult && (
                                            <Button size="sm" variant="ghost" onClick={handleAnalyze} isLoading={isAnalyzing} className="text-xs border border-indigo-500/50">
                                                Analyze
                                            </Button>
                                        )}
                                    </div>
                                    {analysisResult && (
                                        <p className="text-sm text-indigo-100 leading-relaxed italic">
                                            "{analysisResult}"
                                        </p>
                                    )}
                                </div>
                            </Card>
                        )}

                        {/* Weight Input */}
                        <div className="space-y-4">
                            <Label>Bale Weight (lbs/kg)</Label>
                            <div className="relative">
                                <Scale className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={24} />
                                <Input 
                                    type="number"
                                    inputMode="decimal" 
                                    autoFocus
                                    className="pl-14 text-4xl h-20 font-mono bg-slate-950 border-slate-600 focus:border-amber-500"
                                    placeholder="000"
                                    value={weightInput}
                                    onChange={(e) => setWeightInput(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSaveBale()}
                                />
                            </div>
                        </div>

                        <div className="flex flex-col gap-3">
                            <Button 
                                className="w-full py-6 text-xl bg-green-600 hover:bg-green-700 shadow-lg shadow-green-900/50"
                                onClick={handleSaveBale}
                                disabled={!weightInput}
                            >
                                {currentSession.type === 'manual' ? 'Confirm & Next Bale' : 'Confirm Entry'}
                            </Button>
                        </div>
                    </div>
                )}

                {/* Footer Stats */}
                {!selectedBale && (
                    <div className="grid grid-cols-2 gap-4 text-sm text-slate-400 pt-8 border-t border-slate-800">
                        <div className="flex flex-col gap-1 p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 shadow-inner">
                            <span className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-widest text-slate-500"><Weight size={12} /> Running Total Weight</span>
                            <span className="text-3xl text-white font-mono font-black">{totalWeight.toLocaleString()} <span className="text-xs font-normal text-slate-500">LBS</span></span>
                        </div>
                         <div className="flex flex-col gap-1 p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 shadow-inner">
                            <span className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-widest text-slate-500"><Hash size={12} /> Bales Processed</span>
                            <span className="text-3xl text-white font-mono font-black">{currentSession.bales.filter(b => b.status === 'completed').length}</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
      );
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-amber-500/30">
        {view === 'HOME' && renderHome()}
        {view === 'SETUP_EXCEL' && (
            <div className="flex flex-col items-center justify-center min-h-screen p-4">
                 <input type="file" id="hidden-file-input" className="hidden" onChange={handleFileUpload} accept=".xlsx, .xls" />
                 <Card className="p-12 text-center space-y-6 max-w-lg w-full">
                    <div className="w-20 h-20 bg-slate-700 rounded-full flex items-center justify-center mx-auto text-blue-400">
                        <FileText size={40} />
                    </div>
                    <h2 className="text-2xl font-bold">Upload Inventory</h2>
                    <p className="text-slate-400">Select an Excel file containing your bale inventory to enable fuzzy search and quality mapping.</p>
                    <div className="flex flex-col gap-3">
                         <Button onClick={handleNativeFileUpload} className="w-full">
                            Select File
                         </Button>
                         <Button variant="ghost" onClick={() => setView('HOME')}>Cancel</Button>
                    </div>
                 </Card>
            </div>
        )}
        {view === 'SETUP_MANUAL' && (
             <div className="max-w-md mx-auto p-4 pt-12 space-y-6">
                 <h2 className="text-2xl font-bold">Manual Session Setup</h2>
                 <div>
                    <Label>Mill Lot Number</Label>
                    <Input 
                        value={setupConfig.startMillLot}
                        onChange={(e) => setSetupConfig({...setupConfig, startMillLot: e.target.value})}
                    />
                 </div>
                 <div>
                    <Label>Starting Bale #</Label>
                    <Input 
                        type="number"
                        value={setupConfig.startMillBale}
                        onChange={(e) => setSetupConfig({...setupConfig, startMillBale: parseInt(e.target.value)})}
                    />
                 </div>
                 <div className="flex gap-4">
                     <Button variant="ghost" onClick={() => setView('HOME')} className="flex-1">Back</Button>
                     <Button onClick={finishManualSetup} className="flex-1">Start</Button>
                 </div>
             </div>
        )}
        {view === 'MAPPING' && renderMapping()}
        {view === 'WORKBENCH' && renderWorkbench()}
    </div>
  );
}
