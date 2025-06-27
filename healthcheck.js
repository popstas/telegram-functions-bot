import http from 'http';

function request(path) {
  return new Promise((resolve) => {
    const req = http.get({ host: 'localhost', port: process.env.PORT || 7586, path }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });
    req.on('error', () => resolve({ statusCode: 0, data: '' }));
  });
}

(async () => {
  const ping = await request('/ping');
  if (ping.statusCode !== 200) {
    console.error('Ping failed');
    process.exit(1);
  }
  const health = await request('/health');
  if (health.statusCode !== 200) {
    console.error('Health endpoint unavailable');
    process.exit(1);
  }
  try {
    const { botsRunning, mqttConnected } = JSON.parse(health.data);
    if (!botsRunning || !mqttConnected) {
      console.error('Bots or MQTT unhealthy');
      process.exit(1);
    }
  } catch {
    console.error('Invalid health response');
    process.exit(1);
  }
  process.exit(0);
})();
