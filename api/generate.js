export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { city } = req.body;

  if (!city) {
    return res.status(400).json({ error: 'City is required' });
  }

  const prompt = `あなたはゲームデザイナーです。「${city}」のご当地モンスターを設計してください。

まず${city}の以下の情報を内部で調査・分析してください：
- 歴史的背景（創設、合戦、人物、時代）
- 地形・気候（山、川、海、気温、降水量）
- 特産品・産業（食べ物、工芸品、伝統産業）
- 伝説・民話・妖怪伝承
- 現代的な特徴・シンボル

その分析をもとに、以下のJSON形式でモンスターを出力してください。JSONのみを出力し、前後に説明文やマークダウンは一切つけないこと。

{
  "name": "モンスターの名前（その市の特徴を反映した造語、カタカナ）",
  "emoji": "最もイメージに近い絵文字1文字",
  "city": "${city}",
  "concept": "このモンスターのコンセプト説明（2〜3文）",
  "types": ["タイプ1", "タイプ2"],
  "stats": {
    "hp": 数値(50-150),
    "atk": 数値(30-80),
    "def": 数値(20-70),
    "spd": 数値(20-70)
  },
  "weatherStrong": ["strong1", "strong2"],
  "weatherWeak": ["weak1", "weak2"],
  "promptJa": ["特徴1","特徴2","特徴3","特徴4","特徴5","スタイル","色調"],
  "promptEn": ["feature1","feature2","feature3","feature4","feature5","style","palette"],
  "lore": "歴史・文化的根拠（3〜5文）"
}`;

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
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    const fullText = data.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    let jsonStr = null;
    const codeBlock = fullText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) {
      jsonStr = codeBlock[1].trim();
    } else {
      const raw = fullText.match(/\{[\s\S]*\}/);
      if (raw) jsonStr = raw[0];
    }

    if (!jsonStr) {
      return res.status(500).json({ error: 'JSONが取得できませんでした' });
    }

    const monster = JSON.parse(jsonStr);
    res.status(200).json(monster);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
