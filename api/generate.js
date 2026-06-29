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

    // DALL-Eで画像生成
    try {
      const imagePrompt = (monster.promptEn || []).join(', ');
      const dalleRes = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY,
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt: imagePrompt,
          n: 1,
          size: '1024x1024',
          quality: 'standard',
        }),
      });

      const dalleData = await dalleRes.json();

      if (dalleData.error) {
        monster.imageError = dalleData.error.message;
      } else if (dalleData.data && dalleData.data[0] && dalleData.data[0].url) {
        const imageUrl = dalleData.data[0].url;
        const imageRes = await fetch(imageUrl);
        const imageBlob = await imageRes.blob();
        const fileName = 'monsters/' + city.replace(/[^\w]/g, '') + '.png';

        const { url } = await put(fileName, imageBlob, {
          access: 'public',
          contentType: 'image/png',
        });

        monster.imageUrl = url;
      } else {
        monster.imageError = 'No image data returned: ' + JSON.stringify(dalleData);
      }
    } catch (dalleError) {
      monster.imageError = dalleError.message;
    }

    return res.status(200).json(monster);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
