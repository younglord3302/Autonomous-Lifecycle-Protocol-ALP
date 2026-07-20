(function() {
  function initStars() {
    const container = document.createElement('div');
    container.className = 'stars-container';
    const stars = [];
    for (let i = 0; i < 12; i++) {
      const star = document.createElement('div');
      star.className = 'star';
      star.style.animationDelay = (i * 0.5) + 's';
      star.style.animationDuration = (4 + Math.random() * 4) + 's';
      container.appendChild(star);
      stars.push(star);
    }
    document.body.appendChild(container);

    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let currentX = mouseX;
    let currentY = mouseY;

    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    });

    function animate() {
      currentX += (mouseX - currentX) * 0.03;
      currentY += (mouseY - currentY) * 0.03;

      const offsetX = (currentX - window.innerWidth / 2) / window.innerWidth;
      const offsetY = (currentY - window.innerHeight / 2) / window.innerHeight;

      container.style.transform = `translate(${offsetX * 30}px, ${offsetY * 30}px)`;

      requestAnimationFrame(animate);
    }

    animate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStars);
  } else {
    initStars();
  }
})();
