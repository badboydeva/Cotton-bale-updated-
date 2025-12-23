import React, { useEffect, useRef, useState } from 'react';
import { X, Zap, ZapOff, Camera, QrCode } from 'lucide-react';

// Declaration for the global Html5Qrcode library
declare const Html5Qrcode: any;

interface ScannerProps {
  onScan: (decodedText: string) => void;
  onClose: () => void;
}

export const Scanner: React.FC<ScannerProps> = ({ onScan, onClose }) => {
  const [error, setError] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const scannerRef = useRef<any>(null);
  const scannerId = "reader-container";

  useEffect(() => {
    let isMounted = true;
    
    const startScanner = async () => {
      try {
        // Cleanup previous instance if it exists (safety check)
        if (scannerRef.current) {
             try { await scannerRef.current.stop(); } catch(e) {}
        }

        const scanner = new Html5Qrcode(scannerId);
        scannerRef.current = scanner;

        const config = { fps: 10, qrbox: { width: 250, height: 250 } };
        
        // 1. Get Cameras to verify permissions and availability
        const cameras = await Html5Qrcode.getCameras().catch((err: any) => {
             throw { name: 'PermissionError', message: 'Camera permission denied or not supported.' };
        });

        if (!cameras || cameras.length === 0) {
             throw { name: 'NotFoundError', message: 'No cameras found on device.' };
        }

        // Rudimentary torch check - implies capability if cameras exist (refined check requires track access)
        setHasTorch(true); 

        // 2. Start Strategy: Try Environment Mode -> Fallback to First Camera ID
        try {
            await scanner.start(
              { facingMode: "environment" },
              config,
              (decodedText: string) => {
                if (isMounted) onScan(decodedText);
              },
              (errorMessage: string) => {
                // ignore frame errors
              }
            );
        } catch (envError: any) {
            console.warn("Environment mode failed, attempting fallback...", envError);
            
            // If the specific "environment" constraint failed, try the first camera explicitly
            await scanner.start(
                cameras[0].id,
                config,
                (decodedText: string) => {
                    if (isMounted) onScan(decodedText);
                },
                (errorMessage: string) => {}
            );
        }

      } catch (err: any) {
        if (!isMounted) return;
        console.error("Scanner Initialization Error:", err);
        
        let msg = "Failed to start camera.";
        if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError' || err?.name === 'PermissionError') {
             msg = "Camera permission denied. Please check your browser settings.";
        } else if (err?.name === 'NotFoundError') {
             msg = "No camera found on this device.";
        } else if (err?.name === 'NotReadableError' || err?.message?.includes("Could not start video source")) {
             msg = "Camera is currently in use by another app or not accessible.";
        } else if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
            msg = "Scanner requires a secure context (HTTPS).";
        } else if (typeof err === 'string') {
            msg = err;
        }
        
        setError(msg);
      }
    };

    // Slight delay to ensure DOM mount and previous cleanup
    const timer = setTimeout(startScanner, 300);

    return () => {
      isMounted = false;
      clearTimeout(timer);
      if (scannerRef.current) {
        scannerRef.current.stop().catch((e: any) => console.warn("Stop failed during cleanup", e));
        scannerRef.current.clear();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleTorch = () => {
    if (scannerRef.current) {
        try {
            const track = scannerRef.current.getRunningTrack();
            if(track){
                const capabilities = track.getCapabilities();
                if (capabilities.torch) {
                    track.applyConstraints({
                        advanced: [{ torch: !torchOn }]
                    });
                    setTorchOn(!torchOn);
                } else {
                    alert("Torch not supported on this device/camera.");
                }
            }
        } catch (e) {
            console.warn("Torch toggle failed", e);
        }
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center">
      {/* Custom Overlay */}
      <div className="absolute top-0 w-full p-4 flex justify-between items-center z-10 bg-gradient-to-b from-black/80 to-transparent">
        <h2 className="text-white font-bold text-lg flex items-center gap-2">
            <QrCode className="w-5 h-5 text-blue-400" />
            Scan Barcode / QR Code
        </h2>
        <button onClick={onClose} className="p-2 bg-slate-800 rounded-full text-white">
          <X size={24} />
        </button>
      </div>

      <div id={scannerId} className="w-full max-w-md aspect-[3/4] overflow-hidden rounded-lg bg-black relative shadow-2xl">
        {/* The library injects video here */}
      </div>

      {/* Frame Animation */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="w-64 h-64 border-2 border-blue-500 rounded-lg relative animate-pulse shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
            <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-blue-400 -mt-1 -ml-1"></div>
            <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-blue-400 -mt-1 -mr-1"></div>
            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-blue-400 -mb-1 -ml-1"></div>
            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-blue-400 -mb-1 -mr-1"></div>
        </div>
      </div>

      <div className="absolute bottom-10 flex gap-4 z-10">
        {hasTorch && (
            <button 
                onClick={toggleTorch}
                className={`p-4 rounded-full shadow-lg transition-transform active:scale-95 ${torchOn ? 'bg-amber-500 text-black' : 'bg-slate-800 text-white'}`}
            >
                {torchOn ? <ZapOff /> : <Zap />}
            </button>
        )}
      </div>

      {error && (
        <div className="absolute inset-0 bg-slate-900 flex items-center justify-center p-8 text-center z-20">
            <div>
                <p className="text-red-500 text-xl font-bold mb-4">{error}</p>
                <div className="flex flex-col gap-3">
                    <button onClick={() => window.location.reload()} className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg text-white font-medium">
                        Refresh Page
                    </button>
                    <button onClick={onClose} className="bg-slate-700 hover:bg-slate-600 px-6 py-3 rounded-lg text-white font-medium">
                        Close Scanner
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};