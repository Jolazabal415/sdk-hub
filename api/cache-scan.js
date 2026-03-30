async function fetchGameComments(token, gid) {
  try {
    const url = `https://api.asana.com/1.0/tasks/${gid}/stories?opt_fields=text,type`;
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const comments = (data.data || []).filter(s => s.type === 'comment');
    if (comments.length === 0) return null;
    const lastComment = comments[comments.length - 1];
    if (!lastComment.text || lastComment.text.includes('[Attachment]')) return null;
    return lastComment.text;
  } catch (e) {
    return null;
  }
}

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  const token = process.env.ASANA_TOKEN;
  if (!token) return res.status(500).json({ error: 'ASANA_TOKEN not set' });
  
  try {
    const PROJECT_GID = '1213869566862688';
    const games = [];
    let offset = null;
    
    while (true) {
      const url = new URL('https://api.asana.com/1.0/tasks');
      url.searchParams.append('project', PROJECT_GID);
      url.searchParams.append('opt_fields', 'name,gid');
      url.searchParams.append('limit', '100');
      if (offset) url.searchParams.append('offset', offset);
      
      const resp = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!resp.ok) throw new Error('Failed to fetch games');
      
      const data = await resp.json();
      const gameBatch = data.data || [];
      
      for (const game of gameBatch) {
        const comment = await fetchGameComments(token, game.gid);
        if (comment) {
          games.push({
            name: game.name,
            gid: game.gid,
            comment: comment,
            scannedAt: new Date().toISOString()
          });
        }
      }
      
      if (data.next_page?.offset) {
        offset = data.next_page.offset;
      } else {
        break;
      }
    }
    
    const cacheData = {
      games,
      totalGames: games.length,
      scannedAt: new Date().toISOString(),
      nextScanAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    };
    
    res.json({
      success: true,
      message: `Scanned ${games.length} games from SDK Hub`,
      cache: cacheData
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
