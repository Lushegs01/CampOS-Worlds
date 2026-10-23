// Bachs adds ?checkout_id=… to these addresses; only `status` matters here.
  const status = (new URLSearchParams(location.search).get('status') || '').split('?')[0];
  if (status === 'cancelled') {
    document.getElementById('title').textContent = 'Checkout cancelled';
    document.getElementById('text').textContent = 'You have not been charged. You can try again from Appearance whenever you like.';
  }
  // This tab was opened by the game: close it to return there. Opened directly (or the game tab was
  // replaced), go to campus instead.
  document.getElementById('back').addEventListener('click', () => { window.close(); setTimeout(() => location.assign('/'), 200); });
