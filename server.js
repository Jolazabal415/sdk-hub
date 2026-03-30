const http = require('http');
const PORT = process.env.PORT || 3001;
const PROJECT_GID = '799537769102836';

let cachedData = { games: {}, lastFetch: 0, cacheTTL: 10 * 60 * 1000 };

function parseVersionComment(commentText) {
  if (!commentText) return null;
  const versions = {};
  const lines = commentText.split('\n');
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
  
  return Object.keys(versions).length > 0 ? versions : null;
}

async function fetchAllGames() {
  const games = {};
  let offset = null;
  
  try {
    while (true) {
      const params = new URLSearchParams({
        project: PROJECT_GID,
        opt_fields: 'name,gid',
        limit: '50'
      });
      if (offset) params.append('offset', offset);
      
      const response = await fetch(`https://api.asana.com/1.0/tasks?${params}`, {
        headers: { 'Authorization': `Bearer ${process.env.ASANA_TOKEN}` }
      });
      
      if (!response.ok) throw new Error(`Asana API error: ${response.status}`);
      const data = await response.json();
      
      for (const task of data.data || []) {
        try {
          const detailResponse = await fetch(
            `https://api.asana.com/1.0/tasks/${task.gid}?opt_fields=name,custom_fields`,
            { headers: { 'Authorization': `Bearer ${process.env.ASANA_TOKEN}` } }
          );
          if (!detailResponse.ok) continue;
          const taskData = await detailResponse.json();
          const t = taskData.data;
          
          const commentsResponse = await fetch(
            `https://api.asana.com/1.0/tasks/${task.gid}/stories?opt_fields=text,type&limit=100`,
            { headers: { 'Authorization': `Bearer ${process.env.ASANA_TOKEN}` } }
          );
          
          let versionData = null;
          if (commentsResponse.ok) {
            const commentsData = await commentsResponse.json();
            const comments = (commentsData.data || []).filter(c => c.type === 'comment');
            if (comments.length > 0) {
              const lastComment = comments[comments.length - 1];
              if (lastComment.text) {
                versionData = parseVersionComment(lastComment.text);
              }
            }
          }
          
          const customFields = {};
          for (const field of t.custom_fields || []) {
            if (field.name && field.enum_value) {
              customFields[field.name] = field.enum_value.name;
            }
          }
          
          games[t.name] = {
            name: t.name,
            versions: versionData || {},
            sdkStatus: customFields,
            gid: task.gid
          };
        } catch (e) {
          console.error(`Error processing task ${task.gid}:`, e.message);
        }
      }
      
      if (data.next_page && data.next_page.offset) {
        offset = data.next_page.offset;
      } else {
        break;
      }
    }
    
    console.log(`✓ Fetched ${Object.keys(games).length} games`);
    return games;
  } catch (error) {
    console.error('Error fetching games:', error.message);
    return {};
  }
}

function searchGamesByNetwork(games, networkName) {
  const results = [];
  const normalizedNetwork = networkName.toUpperCase();
  
  for (const [gameName, data] of Object.entries(games)) {
    for (const [fieldName, status] of Object.entries(data.sdkStatus || {})) {
      if (fieldName.toUpperCase().includes(normalizedNetwork) && status !== 'Uninstalled') {
        results.push({ name: gameName, network: fieldName, status: status, versions: data.versions[fieldName] || {} });
      }
    }
  }
  return results;
}

function searchGamesByNetworkVersion(games, networkName, version) {
  const results = [];
  const normalizedNetwork = networkName.toUpperCase();
  
  for (const [gameName, data] of Object.entries(games)) {
    for (const [netKey, versionData] of Object.entries(data.versions || {})) {
      if (netKey.toUpperCase().includes(normalizedNetwork)) {
        const sdkVersion = versionData.sdk || '';
        if (sdkVersion.includes(version)) {
          results.push({ name: gameName, network: netKey, version: sdkVersion, adapter: versionData.adapter || 'N/A' });
        }
      }
    }
  }
  return results;
}

function searchOutOfDate(games, networkName, requiredVersion) {
  const results = [];
  const normalizedNetwork = networkName.toUpperCase();
  
  for (const [gameName, data] of Object.entries(games)) {
    let hasNetwork = false, isOutOfDate = false;
    
    for (const [fieldName, status] of Object.entries(data.sdkStatus || {})) {
      if (fieldName.toUpperCase().includes(normalizedNetwork) && status !== 'Uninstalled') {
        hasNetwork = true;
        for (const [netKey, versionData] of Object.entries(data.versions || {})) {
          if (netKey.toUpperCase().includes(normalizedNetwork)) {
            const currentVersion = versionData.sdk || '';
            if (!currentVersion.includes(requiredVersion)) {
              isOutOfDate = true;
            }
          }
        }
      }
    }
    
    if (hasNetwork && isOutOfDate) {
      results.push({ name: gameName, network: normalizedNetwork, requiredVersion: requiredVersion });
    }
  }
  return results;
}

function searchNotUsingNetwork(games, networkName) {
  const results = [];
  const normalizedNetwork = networkName.toUpperCase();
  
  for (const [gameName, data] of Object.entries(games)) {
    let hasNetwork = false;
    for (const [fieldName, status] of Object.entries(data.sdkStatus || {})) {
      if (fieldName.toUpperCase().includes(normalizedNetwork) && status !== 'Uninstalled') {
        hasNetwork = true;
        break;
      }
    }
    if (!hasNetwork) {
      results.push({ name: gameName, network: normalizedNetwork });
    }
  }
  return results;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  
  if (Date.now() - cachedData.lastFetch > cachedData.cacheTTL) {
    cachedData.games = await fetchAllGames();
    cachedData.lastFetch = Date.now();
  }
  
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const params = url.searchParams;
  
  if (pathname === '/api/games') {
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, count: Object.keys(cachedData.games).length, games: cachedData.games }));
  } else if (pathname === '/api/search/by-network') {
    const network = params.get('network');
    if (!network) { res.writeHead(400); res.end(JSON.stringify({ error: 'network parameter required' })); return; }
    const results = searchGamesByNetwork(cachedData.games, network);
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, network, count: results.length, results }));
  } else if (pathname === '/api/search/by-network-version') {
    const network = params.get('network');
    const version = params.get('version');
    if (!network || !version) { res.writeHead(400); res.end(JSON.stringify({ error: 'network and version required' })); return; }
    const results = searchGamesByNetworkVersion(cachedData.games, network, version);
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, network, version, count: results.length, results }));
  } else if (pathname === '/api/search/out-of-date') {
    const network = params.get('network');
    const version = params.get('version');
    if (!network || !version) { res.writeHead(400); res.end(JSON.stringify({ error: 'network and version required' })); return; }
    const results = searchOutOfDate(cachedData.games, network, version);
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, network, version, count: results.length, results }));
  } else if (pathname === '/api/search/not-using') {
    const network = params.get('network');
    if (!network) { res.writeHead(400); res.end(JSON.stringify({ error: 'network parameter required' })); return; }
    const results = searchNotUsingNetwork(cachedData.games, network);
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, network, count: results.length, results }));
  } else if (pathname === '/api/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', gamesLoaded: Object.keys(cachedData.games).length }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, () => {
  console.log(`✓ SDK Hub Backend running on port ${PORT}`);
  console.log('Fetching initial data...');
  fetchAllGames().then(games => {
    cachedData.games = games;
    cachedData.lastFetch = Date.now();
    console.log(`✓ Ready with ${Object.keys(games).length} games!`);
  });
});
