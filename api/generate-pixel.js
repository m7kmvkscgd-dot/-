const { put } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { monsterName, types, promptEn, city, stage } = req.body;
  if (!monsterName || !city) {
    return res.status(400).json({ error: 'monsterName and city are required' });
  }

  try {
    const featureBase = Array.isArray(promptEn) && promptEn.length > 0
      ? promptEn.slice(0, 3).join(', ')
      : (monsterName + ', ' + (Array.isArray(types) ? types.join('/') : 'unknown') + ' type monster');

    const pixelPrompt = featureBase
      + ', pixel art sprite, 16-bit JRPG game character, side view facing RIGHT,'
      + ' full body, black pixel outline, retro game sprite,'
      + ' transparent background, isolated character on transparent background';

    const imageRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY,
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: pixelPrompt,
        n: 1,
        size: '1024x1024',
        quality: 'low',
        background: 'transparent',
        output_format: 'png',
      }),
    });

    const imageData = await imageRes.json();
    if (!imageData.data || !imageData.data[0] || !imageData.data[0].b64_json) {
      return res.status(500).json({ error: 'No image data from OpenAI', detail: imageData });
    }

    const b64 = imageData.data[0].b64_json;
    const buffer = Buffer.from(b64, 'base64');
    const safeName = city.replace(/[^\w぀-ヿ一-鿿]/g, '') || 'unknown';
    const fileName = 'pixels/' + safeName + '_' + (stage || 'adult') + '.png';

    const { url } = await put(fileName, buffer, {
      access: 'public',
      contentType: 'image/png',
    });

    return res.status(200).json({ pixelImageUrl: url });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
