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
    const content = 'You are a game designer. Design a local monster for the Japanese city of ' + city + '. Research its history, geography, local specialties, legends, and modern characteristics. Current weather at player location: ' + weather + '. Output ONLY a valid JSON object with no explanation, no markdown, no code blocks. The JSON must use double quotes only. Format: {"name":"katakana monster name","emoji":"single emoji","city":"' + city + '","concept":"concept in Japanese","types":["type1","type2"],"stats":{"hp":100,"atk":50,"def":40,"spd":35},"weatherStrong":["clear","rain"],"weatherWeak":["snow","thunder"],"promptJa":["外観の特徴1","外観の特徴2","外観の特徴3","外観の特徴4","外観の特徴5","ポケモン風かわいいデフォルメキャラクター、正方形512x512、キャラクターが画面の70%を占める、モンスターのタイプに合った自然や環境の背景あり、日本アニメRPGスタイル","色調と雰囲気","ドット絵バージョン32pxレトロゲームスタイル"],"promptEn":["visual feature 1","visual feature 2","visual feature 3","visual feature 4","visual feature 5","512x512px square format, soft gradient background matching the monster color theme NOT transparent, pokemon-style cute chibi character centered taking 70% of image, simple beautiful background with nature or environment elements matching the monster type, Japanese anime RPG game art","color palette and mood","pixel art 32px retro SNES Game Boy style sprite"],"lore":"lore in Japanese"}';

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
        messages: [{ role: 'user', content: content }],
      }),
    });

    const data = await response.json();

    if (!data.content || !data.content[0]) {
      return res.status(500).json({ error: 'No response from API' });
    }

    const text = data.content[0].text;
    const match = text.match(/\{[\s\S]*\}/);

    if (!match) {
      return res.status(500).json({ error: 'No JSON found in response' });
    }

    const monster = JSON.parse(match[0]);
    return res.status(200).json(monster);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
