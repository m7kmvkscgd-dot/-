module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

const { city, weatherInfo } = req.body;

  if (!city) {
    return res.status(400).json({ error: 'City is required' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          Also consider this current weather data for the player location: ' + (weatherInfo || 'unknown') + '.
          content: 'You are a game designer. Design a local monster for the Japanese city of ' + city + '. Research its history, geography, local specialties, legends, and modern characteristics. Output ONLY a valid JSON object with no explanation, no markdown, no code blocks. The JSON must use double quotes only. Format: {"name":"katakana monster name","emoji":"single emoji","city":"' + city + '","concept":"concept in Japanese","types":["type1","type2"],"stats":{"hp":100,"atk":50,"def":40,"spd":35},"weatherStrong":["clear","rain"],"weatherWeak":["snow","thunder"],"promptJa":["feature1","feature2","feature3","feature4","feature5","pokemon cute chibi style","colors","pixel art 32px"],"promptEn":["feature1","feature2","feature3","feature4","feature5","pokemon cute chibi style","colors","pixel art 32px"],"lore":"lore in Japanese"}'
        }],
      }),
    });

     data = await response.json();

    if (!data.content || !data.content[0]) {
      return res.status(500).json({ error: 'No response from API' });
    }

     text = data.content[0].text;

     match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return res.status(500).json({ error: 'No JSON found in response' });
    }

     monster = JSON.parse(match[0]);
    return res.status(200).json(monster);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
