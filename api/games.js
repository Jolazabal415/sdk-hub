let cachedGames = null;
let cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000;

function parseVersionComment(text) {
  if (!text) return {};
  const versions = {};
  const lines = text.split('\n');
  let currentNetwork = null;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('----------') && trimmed.endsWith('----------')) {
      const match = trimmed.match(/----------\s+(.+?)\s+----------/);
      if (match) {
        currentNetwork = match[1];
        versions[currentNetwork] = {};
      }
    }
    if (currentNetwork && trimmed.startsWith('SDK') && trimmed.includes('-')) {
      const match = trimmed.match(/SDK\s*-\s*(.+?)$/);
      if (match) versions[currentNetwork].sdk = match[1].trim();
    }
    if (currentNetwork && trimmed.startsWith('Adapter')) {
      const match = trimmed.match(/Adapter\s*-\s*(.+?)$/);
      if (match) versions[currentNetwork].adapter = match[1].trim();
    }
  }
  return versions;
}

async function fetchGames() {
  const token = process.env.ASANA_TOKEN;
  if (!token) throw new Error('ASANA_TOKEN not set');
  
  const games = {};
  let offset = null;
  const PROJECT_GID = '799537769102836';
  
  try {
    while (true) {
      const url = new URL('https://api.asana.com/1.0/tasks');
      url.searchParams.append('project', PROJECT_GID);
      url.searchParams.append('opt_fields', 'name,gid');
      url.searchParams.append('limit', '50');
      if (offset) url.searchParams.append('offset', offset);
      
      const resp = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!resp.ok) throw new Error(`Asana error: ${resp.status}`);
      
      const data = await resp.json();
      
      for (const task of data.data || []) {
        try {
          const detailResp = await fetch(
            `https://api.asana.com/1.0/tasks/${task.gid}?opt_fields=name,custom_fields`,
            { headers: { 'Authorization': `Bearer ${token}` } }
          );
          if (!detailResp.ok) continue;
          const taskData = await detailResp.json();
          const t = taskData.data;
          
          const storiesResp = await fetch(
            `https://api.asana.com/1.0/tasks/${task.gid}/stories?opt_fields=text,type&limit=100`,
            { headers: { 'Authorization': `Bearer ${token}` } }
          );
          
          let versionData = {};
          if (storiesResp.ok) {
            const stories = await storiesResp.json();
            const comments = (stories.data || []).filter(s => s.type === 'comment');
            if (comments.length > 0) {
              const lastComment = comments[comments.length - 1];
              if (lastComment.text) {
                versionData = parseVersionComment(lastComment.text);
              }
            }
          }
          
          const sdkStatus = {};
          for (const field of t.custom_fields || []) {
            if (field.name && field.enum_value) {
              sdkStatus[field.name] = field.enum_value.name;
            }
          }
          
          games[t.name] = {
            name: t.name,
            versions: versionData,
            sdkStatus: sdkStatus,
            gid: task.gid
          };
        } catch (e) {
          console.error(`Error on task ${task.gid}:`, e.message);
        }
      }
      
      if (data.next_page?.offset) {
        offset = data.next_page.offset;
      } else {
        break;
      }
    }
    
    return games;
  } catch (err) {
    console.error('Fetch error:', err);
    throw err;
  }
}

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  try {
    if (Date.now() - cacheTime > CACHE_TTL || !cachedGames) {
      cachedGames = await fetchGames();
      cacheTime = Date.now();
    }
    
    res.status(200).json({
      success: true,
      count: Object.keys(cachedGames).length,
      games: cachedGames
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
