export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  const { network } = req.query;
  if (!network) {
    return res.status(400).json({ error: 'network parameter required' });
  }
  
  try {
    const gamesResp = await fetch('https://sdk-hub.vercel.app/api/games');
    const { games } = await gamesResp.json();
    
    const results = [];
    const normalizedNet = network.toUpperCase();
    
    for (const [name, data] of Object.entries(games || {})) {
      for (const [fieldName, status] of Object.entries(data.sdkStatus || {})) {
        if (fieldName.toUpperCase().includes(normalizedNet) && status !== 'Uninstalled') {
          results.push({ name, network: fieldName, status, versions: data.versions[fieldName] || {} });
        }
      }
    }
    
    res.status(200).json({ success: true, network, count: results.length, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
