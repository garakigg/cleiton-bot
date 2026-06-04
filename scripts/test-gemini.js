import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
const models = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || 'gemini-2.0-flash')
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);

if (!apiKey) {
  console.error('GEMINI_API_KEY nao foi encontrada no .env.');
  process.exit(1);
}

try {
  const gemini = new GoogleGenAI({ apiKey });
  let response = null;
  let usedModel = models[0];
  let lastError = null;

  for (const model of models) {
    try {
      response = await gemini.models.generateContent({
        model,
        contents: 'Responda apenas: Cleiton online.'
      });
      usedModel = model;
      break;
    } catch (error) {
      lastError = error;
      console.error(`Falhou em ${model}: ${error?.status || error?.code || 'sem status'}`);
    }
  }

  if (!response) throw lastError;

  console.log(`OK: chave respondeu usando ${usedModel}`);
  console.log(response.text?.trim() || '(sem texto)');
} catch (error) {
  console.error(`ERRO: Gemini recusou a chamada usando os modelos: ${models.join(', ')}.`);
  console.error(`Status: ${error?.status || error?.code || 'desconhecido'}`);
  console.error(error?.message || String(error));
  process.exitCode = 1;
}
