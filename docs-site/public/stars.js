(function() {
  const container = document.createElement('div');
  container.className = 'stars-container';
  for (let i = 0; i < 6; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.animationDelay = (i * 1.5) + 's';
    star.style.animationDuration = (7 + Math.random() * 5) + 's';
    container.appendChild(star);
  }
  document.body.appendChild(container);
})();
