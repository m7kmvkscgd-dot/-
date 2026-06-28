module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { city } = req.body;
  if (!city) {
    return res.status(400).json({ error: 'City is required' });
  }

  const prompt = `You are a game designer. Design a local monster for "${city}" in Japan.

Research and analyze the following about ${city}:
- Historical background
- Geography and climate
- Local specialties and industries
- Legends and folklore
- Modern characteristics and symbols

Output ONLY a JSON object with no explanation or markdown. Use this exact format:

{"name":"monster name in katakana reflecting local characteristics","emoji":"single emoji","city":"${city}","concept":"monster concept in Japanese 2-3 sentences","types":["type1","type2"],"stats":{"hp":100,"atk":50,"def":40,"spd":35},"weatherStrong":["clear","rain"],"weatherWeak":["snow","thunder"],"promptJa":["visual feature 1 in Japanese","visual feature 2 in Japanese","visual feature 3 in Japanese","visual feature 4 in Japanese","visual feature 5 in Japanese","pokemon style cute chibi game art rounded friendly proportions","color palette and atmosphere","pixel art 32px retro SNES game boy style"],"promptEn":["visual feature 1","visual feature 2","visual feature 3","visual feature 4","visual feature 5","Pokemon-style cute chibi character design rounded friendly proportions Japanese game art","color palette and mood","pixel art 32px retro SNES Game Boy style sprite"],"lore":"historical and cultural basis in Japanese 3-5 sentences"}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
