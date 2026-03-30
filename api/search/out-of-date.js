export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  const { network, version } = req.query;
  if (!network || !version) {
    return res.status(400).json({ error: 'network and version required' });
  }
  
  try {
    const gamesResp = await fetch('https://sdk-hub.vercel.app/api/games');
    const { games } = await gamesResp.json();
    
    const results = [];
    const normalizedNet = network.toUpperCase();
    
    for (const [name, data] of Object.entries(games || {})) {
      let hasNetwork = false, isOutOfDate = false;
      
      for (const [fieldName, status] of Object.entries(data.sdkStatus || {})) {
        if (fieldName.toUpperCase().includes(normalizedNet) && status !== 'Uninstalled') {
          hasNetwork = true;
          for (const [netKey, versionData] of Object.entries(data.versions || {})) {
            if (netKey.toUpperCase().includes(normalizedNet)) {
              if (!(versionData.sdk || '').includes(version)) {
                isOutOfDate = true;
              }
            }
          }
        }
      }
      
      if (hasNetwork && isOutOfDate) {
        results.push({ name, network: normalizedNet, requiredVersion: version });
      }
    }
    
    res.status(200).json({ success: true, network, version, count: results.length, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
