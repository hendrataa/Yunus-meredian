import('./hive-mind.js').then(async m => {
  if (!m.isEnabled()) {
    console.log('Hive NOT configured. Set hiveMindUrl and hiveMindApiKey in user-config.json');
    process.exit(1);
  }
  const p = await m.getHivePulse();
  if (p) {
    console.log('Connected to Hive Mind!');
    console.log('Agents:', p.total_agents, '| Deploys:', p.total_deploys, '| Win rate:', p.overall_win_rate);
  } else {
    console.log('Failed to reach hive. Check your hiveMindUrl and hiveMindApiKey.');
  }
});
