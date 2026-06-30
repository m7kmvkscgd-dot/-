const { put } = require('@vercel/blob');
const zlib = require('zlib');

// Flip a PNG buffer horizontally using only Node.js built-ins (no external deps).
// Handles all 5 PNG filter types (None/Sub/Up/Average/Paeth).
function flipPngHorizontal(inputBuf) {
  const sig = [137,80,78,71,13,10,26,10];
  for (let i = 0; i < 8; i++) {
    if (inputBuf[i] !== sig[i]) throw new Error('Not a PNG');
  }

  // CRC32 (required for valid PNG chunks)
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c;
  }
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function makeChunk(typeStr, data) {
    const type = Buffer.from(typeStr, 'ascii');
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    type.copy(out, 4);
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length);
    return out;
  }

  // Parse PNG chunks
  let pos = 8;
  let width, height, bpp, ihdrData;
  const idatBufs = [];
  const metaChunks = [];

  while (pos < inputBuf.length) {
    const len = inputBuf.readUInt32BE(pos);
    const type = inputBuf.slice(pos + 4, pos + 8).toString('ascii');
    const data = inputBuf.slice(pos + 8, pos + 8 + len);
    pos += 12 + len;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const colorType = data[9];
      const chanMap = { 0:1, 2:3, 3:1, 4:2, 6:4 };
      bpp = chanMap[colorType] || 4;
      ihdrData = data;
    } else if (type === 'IDAT') {
      idatBufs.push(data);
    } else if (type !== 'IEND') {
      metaChunks.push({ type, data });
    }
  }

  // Decompress image data
  const raw = zlib.inflateSync(Buffer.concat(idatBufs));
  const rowStride = 1 + width * bpp; // 1 filter byte + pixel bytes

  // Defilter all rows → raw RGBA pixels
  const pixels = Buffer.alloc(height * width * bpp);
  for (let y = 0; y < height; y++) {
    const f = raw[y * rowStride];
    const priorRow = y > 0 ? pixels.slice((y-1) * width * bpp, y * width * bpp) : Buffer.alloc(width * bpp);
    const currRow  = pixels.slice(y * width * bpp, (y+1) * width * bpp);
    for (let x = 0; x < width * bpp; x++) {
      const byte = raw[y * rowStride + 1 + x];
      const a = x >= bpp ? currRow[x - bpp] : 0;
      const b = priorRow[x];
      const c = x >= bpp ? priorRow[x - bpp] : 0;
      let v;
      if      (f === 0) { v = byte; }
      else if (f === 1) { v = (byte + a) & 0xFF; }
      else if (f === 2) { v = (byte + b) & 0xFF; }
      else if (f === 3) { v = (byte + Math.floor((a + b) / 2)) & 0xFF; }
      else {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2*c);
        v = (byte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xFF;
      }
      currRow[x] = v;
    }
  }

  // Flip each row horizontally, output with filter type 0 (None)
  const outRaw = Buffer.alloc(height * rowStride);
  for (let y = 0; y < height; y++) {
    outRaw[y * rowStride] = 0;
    const srcRow = pixels.slice(y * width * bpp, (y+1) * width * bpp);
    for (let x = 0; x < width; x++) {
      const sp = x * bpp;
      const dp = (width - 1 - x) * bpp;
      srcRow.copy(outRaw, y * rowStride + 1 + dp, sp, sp + bpp);
    }
  }

  const recompressed = zlib.deflateSync(outRaw, { level: 6 });
  return Buffer.concat([
    Buffer.from(sig),
    makeChunk('IHDR', ihdrData),
    ...metaChunks.map(c => makeChunk(c.type, c.data)),
    makeChunk('IDAT', recompressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function redisGet(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL + '/get/' + encodeURIComponent(key);
  const res = await fetch(url, {
    headers: { Authorization: 'Bearer ' + process.env.UPSTASH_REDIS_REST_TOKEN }
  });
  const data = await res.json();
  if (!data.result) return null;
  return JSON.parse(data.result);
}

async function redisSet(key, value) {
  const url = process.env.UPSTASH_REDIS_REST_URL + '/set/' + encodeURIComponent(key);
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.UPSTASH_REDIS_REST_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(value),
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { city, weatherInfo, stage, childMonster } = req.body;
  if (!city) {
    return res.status(400).json({ error: 'City is required' });
  }

  const cacheKey = 'monster:' + (stage || 'adult') + ':' + city;
  const cached = await redisGet(cacheKey);
  if (cached) {
    return res.status(200).json(cached);
  }

  try {
    const weather = weatherInfo || 'unknown';
    const isChild = stage === 'child';

    // Child: 1 move whose type matches the monster's own type
    const childMovesNote = ' Give it exactly 1 move. The move type MUST match the monster\'s own type exactly. Give it "light" weight (power 60-90, hiragana-leaning name) befitting a child form. Format: "moves":[{"name":"わざ名","type":"モンスターのtypesと同じタイプ","weight":"light","power":65,"strong_against":["タイプ1"]}]';

    // Type-based visual direction parameters
    const TYPE_CUTE_PROB = { '火':0.30,'水':0.60,'木':0.70,'雷':0.40,'雲':0.65,'土':0.20,'氷':0.50,'鉄':0.25,'念':0.55 };
    const TYPE_COLOR_HINT = {
      '火':'red and orange', '水':'blue and cyan', '木':'green',
      '雷':'yellow and gold', '雲':'white and light blue', '土':'brown and earthy tan',
      '氷':'white and pale ice blue', '鉄':'silver and steel grey', '念':'purple and pink'
    };

    // Body build: light 20% / medium 60% / heavy 20%
    const BUILD_DESC = {
      heavy:  'heavy build: large and stocky — broad body, thick limbs, imposing physical presence. Stats tendency: HP and DEF lean high, SPD leans low.',
      medium: 'medium build: balanced proportions — standard body frame, moderate size. Stats tendency: no extreme bias, all stats balanced.',
      light:  'light build: small and slender — lean frame, lithe limbs, compact size. Stats tendency: SPD leans high, HP and DEF lean low.',
    };
    function rollBuild() {
      const r = Math.random();
      return r < 0.20 ? 'light' : r < 0.80 ? 'medium' : 'heavy';
    }
    // Move weight probability per build: heavy=65%heavy, medium=50/50, light=35%heavy
    function rollMoveWeight(build) {
      const p = build === 'heavy' ? 0.65 : build === 'light' ? 0.35 : 0.50;
      return Math.random() < p ? 'heavy' : 'light';
    }
    function wDesc(w) {
      return w === 'heavy'
        ? 'weight="heavy" (power 80-120, kanji-heavy imposing name like a powerful strike)'
        : 'weight="light" (power 60-90, hiragana-leaning or onomatopoeic flowing name)';
    }
    function buildMovesNote(m1w, m2w) {
      return ' Give it exactly 2 signature moves inspired by the local culture, history, or geography of ' + city + '.'
        + ' Move 1 (first in array): ' + wDesc(m1w) + '.'
        + ' Move 2 (second in array): ' + wDesc(m2w) + '.'
        + ' Each move must have a type from [火,水,木,雷,雲,土,氷,鉄,念] and 1-2 types it is strong against.'
        + ' Format: "moves":[{"name":"技名","type":"タイプ","weight":"' + m1w + '","power":' + (m1w === 'heavy' ? 100 : 70) + ',"strong_against":["タイプ1"]},{"name":"技名","type":"タイプ","weight":"' + m2w + '","power":' + (m2w === 'heavy' ? 100 : 70) + ',"strong_against":["タイプ1"]}]';
    }

    let adultMoveWeights = ['heavy', 'light'];
    let stageNote = '';
    if (isChild) {
      stageNote = 'This is the CHILD form. Make it look young, small, and cute. It should hint at what it will become as an adult but be clearly immature and less powerful. The monster must have EXACTLY 1 type (types array must have exactly one element). Write the lore in Japanese in 2-3 short sentences only.' + childMovesNote;
    } else if (childMonster) {
      // Type is known — resolve cute/fierce and build server-side
      const knownType = childMonster.types[0];
      const r = Math.random();
      const isCute = r < (TYPE_CUTE_PROB[knownType] ?? 0.5);
      const styleDir = isCute
        ? 'cute and charming — chubby rounded body, large expressive friendly eyes, soft gentle expression, endearing presence'
        : 'cool and stylish — sleek powerful silhouette, sharp stylish features, confident dynamic expression, legendary cool presence';
      const colorHint = TYPE_COLOR_HINT[knownType] || 'neutral';
      const visualNote = ' Visual personality for this adult form: ' + styleDir + '. Color palette: base the design primarily on ' + colorHint + ' tones to match its type (minor accent colors are fine). ALWAYS maintain consistent pokemon-style chibi art — same deformed proportions, same line weight — regardless of cute or cool direction.';
      // Body build (independent axis)
      const build = rollBuild();
      const buildNote = ' Body build (INDEPENDENT of cute/cool direction):' + BUILD_DESC[build] + '. Combine both axes freely (e.g., heavy+cute = large and endearing; light+cool = small but razor-sharp and stylish).';
      // Move weights based on build
      const m1w = rollMoveWeight(build);
      const m2w = rollMoveWeight(build);
      adultMoveWeights = [m1w, m2w];
      const movesNote = buildMovesNote(m1w, m2w);
      // Move type combo (80% different types, 20% same type)
      const moveTypeRoll = Math.random();
      const moveTypeNote = moveTypeRoll < 0.80
        ? ' Move types: the first move MUST be type "' + knownType + '" (monster\'s own type). The second move MUST be a DIFFERENT type from [火,水,木,雷,雲,土,氷,鉄,念] — pick one that thematically fits the locale or concept.'
        : ' Move types: BOTH moves MUST be type "' + knownType + '" (same as the monster\'s own type — pure same-type attacker).';
      stageNote = 'This is the ADULT form. It is the evolved version of this child monster: name="' + childMonster.name + '", concept="' + childMonster.concept + '", types=' + JSON.stringify(childMonster.types) + '. The adult must look like a clear evolution of the child - same general theme, but larger, more powerful, and more detailed. Keep the same concept and types as the child. Give the adult a NEW katakana name: it must feel clearly related to the child name "' + childMonster.name + '" (share a root, sound, or theme) but sound stronger, more evolved, and more legendary — remove any childish or diminutive feel and make it sound imposing and powerful. Do NOT reuse the child name as-is. Keep the same concept and types as the child. Write a NEW lore in Japanese in 2-3 short sentences only - do NOT copy the child lore. Write something more legendary and powerful befitting an adult form.' + visualNote + buildNote + movesNote + moveTypeNote;
    } else {
      // Type unknown — pass random seed so AI self-applies the cute/fierce table
      const r = Math.random().toFixed(3);
      const visualTableNote = ' Visual design: a pre-rolled random value (' + r + ') is provided. After choosing the monster\'s type, compare this value to the cute threshold for that type (火:0.30, 水:0.60, 木:0.70, 雷:0.40, 雲:0.65, 土:0.20, 氷:0.50, 鉄:0.25, 念:0.55) — if the value is BELOW the threshold design cute style (chubby rounded body, large friendly eyes, soft gentle expression); if ABOVE design cool style (sleek powerful silhouette, sharp stylish features, confident dynamic expression). ALWAYS maintain pokemon-style chibi art (same deformed proportions and line weight) regardless of cute or cool direction. Color palette must strongly reflect the chosen type: 火=red/orange, 水=blue/cyan, 木=green, 雷=yellow/gold, 雲=white/light blue, 土=brown/earthy tan, 氷=white/pale ice blue, 鉄=silver/steel grey, 念=purple/pink (accent colors allowed but base tone must match).';
      // Body build (independent axis)
      const build = rollBuild();
      const buildNote = ' Body build (INDEPENDENT of cute/cool direction):' + BUILD_DESC[build] + '. Combine both axes freely (e.g., heavy+cute = large and endearing; light+cool = small but razor-sharp and stylish).';
      // Move weights based on build
      const m1w = rollMoveWeight(build);
      const m2w = rollMoveWeight(build);
      adultMoveWeights = [m1w, m2w];
      const movesNote = buildMovesNote(m1w, m2w);
      // Move type combo (seed-based, AI self-applies)
      const moveTypeRoll = Math.random().toFixed(3);
      const moveTypeNote = ' Move type combination: pre-rolled value (' + moveTypeRoll + '). If value < 0.80: first move = monster\'s own type, second move = a DIFFERENT type from [火,水,木,雷,雲,土,氷,鉄,念] that fits the locale or concept. If value >= 0.80: BOTH moves must be the monster\'s own type.';
      stageNote = 'This is the ADULT form. Make it look mature and fully evolved. The monster must have EXACTLY 1 type (types array must have exactly one element). Write the lore in Japanese in 2-3 short sentences only.' + visualTableNote + buildNote + movesNote + moveTypeNote;
    }

    const baseFormat = '{"name":"katakana monster name","emoji":"single emoji","city":"' + city + '","concept":"concept in Japanese","types":["type1"],"stats":{"hp":100,"atk":50,"def":40,"spd":35},"weatherStrong":["clear","rain"],"weatherWeak":["snow","thunder"],"promptEn":["feature1","feature2","feature3","512x512px square format, three-quarter view angled slightly to the RIGHT (not fully side-on, not fully front-facing — show both the face and the body at a diagonal), full body visible, standing dynamic pose, soft gradient background NOT transparent, pokemon-style cute chibi character centered taking 70% of image, simple beautiful background with nature or environment elements matching the monster type, Japanese anime RPG game art","color palette and mood"],"lore":"lore in Japanese 2-3 sentences","moves":[{"name":"わざ名","type":"タイプ","weight":"light","power":65,"strong_against":["タイプ1"]}]}';

    const adultFormat = '{"name":"katakana monster name","emoji":"single emoji","city":"' + city + '","concept":"concept in Japanese","types":["type1"],"stats":{"hp":100,"atk":50,"def":40,"spd":35},"weatherStrong":["clear","rain"],"weatherWeak":["snow","thunder"],"promptEn":["feature1","feature2","feature3","512x512px square format, three-quarter view angled slightly to the RIGHT (not fully side-on, not fully front-facing — show both the face and the body at a diagonal), full body visible, standing dynamic pose, soft gradient background NOT transparent, pokemon-style cute chibi character centered taking 70% of image, simple beautiful background with nature or environment elements matching the monster type, Japanese anime RPG game art","color palette and mood"],"lore":"lore in Japanese 2-3 sentences","moves":[{"name":"技名","type":"タイプ","weight":"' + adultMoveWeights[0] + '","power":' + (adultMoveWeights[0] === 'heavy' ? 100 : 70) + ',"strong_against":["タイプ1"]},{"name":"技名","type":"タイプ","weight":"' + adultMoveWeights[1] + '","power":' + (adultMoveWeights[1] === 'heavy' ? 100 : 70) + ',"strong_against":["タイプ1"]}]}';

    const content = 'You are a game designer. Design a local monster for the Japanese city of ' + city + '. Research its history, geography, local specialties, legends, and modern characteristics. Current weather at player location: ' + weather + '. ' + stageNote + ' Output ONLY a valid JSON object with no explanation, no markdown, no code blocks. The JSON must use double quotes only. Format: ' + (isChild ? baseFormat : adultFormat);

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
    let monster = JSON.parse(match[0]);
    monster.stage = stage || 'adult';

    // Enforce single type
    if (Array.isArray(monster.types) && monster.types.length > 1) {
      monster.types = [monster.types[0]];
    }

    if (isChild) {
      // Enforce exactly 1 move with type matching monster's type
      const monsterType = monster.types && monster.types[0];
      if (!monster.moves || monster.moves.length === 0) {
        monster.moves = [{ name: 'たいあたり', type: monsterType || '念', weight: 'light', power: 65, strong_against: [] }];
      } else {
        monster.moves = [monster.moves[0]];
        if (monsterType) monster.moves[0].type = monsterType;
      }
    }

    if (!isChild && childMonster) {
      monster.concept = childMonster.concept;
      monster.types = childMonster.types;
      monster.emoji = childMonster.emoji;
    }

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
      if (imageData.data && imageData.data[0] && imageData.data[0].b64_json) {
        const b64 = imageData.data[0].b64_json;
        let buffer = Buffer.from(b64, 'base64');

        // Detect facing direction via Claude vision and flip if left-facing
        const visionDebug = { attempted: false, rawAnswer: null, isLeftFacing: false, flipped: false, error: null, flipError: null };
        let isLeftFacing = false;
        try {
          visionDebug.attempted = true;
          const visionRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': process.env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-6',
              max_tokens: 10,
              messages: [{
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: { type: 'base64', media_type: 'image/png', data: b64 },
                  },
                  {
                    type: 'text',
                    text: 'Is the main character/creature in this image facing toward the LEFT side or the RIGHT side of the image? Reply with exactly one word: LEFT or RIGHT.',
                  },
                ],
              }],
            }),
          });
          const visionData = await visionRes.json();
          if (visionData.error) {
            visionDebug.error = JSON.stringify(visionData.error);
          } else {
            const rawAnswer = (visionData.content && visionData.content[0] && visionData.content[0].text || '').trim().toUpperCase();
            visionDebug.rawAnswer = rawAnswer;
            isLeftFacing = rawAnswer.startsWith('LEFT');
            visionDebug.isLeftFacing = isLeftFacing;
          }
        } catch (visionError) {
          visionDebug.error = visionError.message;
        }

        // Flip horizontally if left-facing (zero external deps — uses flipPngHorizontal above)
        if (isLeftFacing) {
          try {
            buffer = flipPngHorizontal(buffer);
            visionDebug.flipped = true;
          } catch (flipError) {
            visionDebug.flipError = flipError.message;
          }
        }
        monster.visionDebug = visionDebug;

        const fileName = 'monsters/' + city.replace(/[^\w]/g, '') + '_' + (stage || 'adult') + '.png';
        const { url } = await put(fileName, buffer, {
          access: 'public',
          contentType: 'image/png',
        });
        monster.imageUrl = url;
      }
    } catch (imgError) {
      monster.imageError = imgError.message;
    }

    await redisSet(cacheKey, monster);
    return res.status(200).json(monster);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
