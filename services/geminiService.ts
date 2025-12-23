import { GoogleGenAI } from "@google/genai";

// Initialize the client safely
const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.error("API Key not found in environment");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

export const analyzeCottonQuality = async (
  mic: string | number,
  strength: string | number,
  otherMetrics: Record<string, any>
): Promise<string> => {
  const ai = getClient();
  if (!ai) return "AI Configuration Error: Missing API Key.";

  const prompt = `
    Act as a professional cotton classer. Analyze this HVI data for a single bale.
    Micronaire: ${mic}
    Strength: ${strength}
    Other Data: ${JSON.stringify(otherMetrics)}

    Provide a strict 3-sentence professional assessment of this cotton's quality, spinning potential, and any premium/discount implications. 
    Do not use introductory filler words.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text || "Analysis complete.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Unable to generate quality analysis at this time.";
  }
};
