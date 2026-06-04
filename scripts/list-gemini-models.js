import 'dotenv/config';

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error('GEMINI_API_KEY nao foi encontrada no .env.');
  process.exitCode = 1;
} else {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    console.error(`Erro ao listar modelos: ${response.status}`);
    console.error(JSON.stringify(data, null, 2));
    process.exitCode = 1;
  } else {
    const models = (data.models || [])
      .filter((model) => model.supportedGenerationMethods?.includes('generateContent'))
      .map((model) => model.name.replace('models/', ''))
      .sort();

    console.log('Modelos disponiveis para generateContent:');
    for (const model of models) console.log(`- ${model}`);
  }
}
