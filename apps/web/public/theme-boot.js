// Sets the saved appearance before the app's code loads, so a chosen theme never flashes the other one.
try {
  var theme = localStorage.getItem('qasa.theme');
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
  if (localStorage.getItem('qasa.density') === 'compact') document.documentElement.dataset.density = 'compact';
} catch (e) { /* storage not available: as the system */ }
