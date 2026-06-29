const { put } = require('@vercel/blob');
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { city, weatherInfo } = req.body;
  if (!city) {
    return res.status(400).json({ error: 'City is required' });
  }
  try {
    const weather = weatherInfo || 'unknown';
    const content = 'You are a game designer. Design a local monster for the Japanese city of ' + city + '. Research its history, geography, local specialties, legends, and modern characteristics. Current weather at player location: ' + weather + '. Output ONLY a valid JSON object with no explanation, no markdown, no code blocks. The JSON must use double quotes only. Format: {"name":"katakana monster name","emoji":"single emoji","city":"' + city + '","concept":"concept in Japanese","types":["type1","type2"],"stats":{"hp":100,"atk":50,"def":40,"spd":35},"weatherStrong":["clear","rain"],"weatherWeak":["snow","thunder"],"promptJa":["feature1","feature2","feature3","feature4","feature5","pokemon cute chibi style","colors","pixel art 32px"],"promptEn":["feature1","feature2","feature3","feature4","feature5","512x512px square format, soft gradient background matching the monster color theme NOT transparent, pokemon-style cute chibi character centered taking 70% of image, simple beautiful background with nature or environment elements matching the monster type, Japanese anime RPG game art","color palette and mood","pixel art 32px retro SNES Game Boy style sprite"],"lore":"lore in Japanese"}';
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: content }],
      }),
    });
    const claudeData = await claudeRes.json();
    if (!claudeData.content || !claudeData.content[0]) {
      return res.status(500).json({ error: 'No response from Claude API' });
    }
    const text = claudeData.content[0].text;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return res.status(500).json({ error: 'No JSON found in response' });
    }
    const monster = JSON.parse(match[0]);
    // gpt-image-1で画像生成
    try {
      const imagePrompt = (monster.promptEn || []).join(', ');
      const imageRes = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY,
        },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt: imagePrompt,
          n: 1,
          size: '1024x1024',
          quality: 'medium',
        }),
      });
      const imageData = await imageRes.json();
      if (imageData.error) {
        monster.imageError = imageData.error.message;
      } else if (imageData.data && imageData.data[0] && imageData.data[0].b64_json) {
        const b64 = imageData.data[0].b64_json;
        const buffer = Buffer.from(b64, 'base64');
        const fileName = 'monsters/' + city.replace(/[^\w]/g, '') + '.png';
        const { url } = await put(fileName, buffer, {
          access: 'public',
          contentType: 'image/png',
        });
        monster.imageUrl = url;
      } else {
        monster.imageError = 'No image data returned: ' +
