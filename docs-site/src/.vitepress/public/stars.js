(function() {
  function initStars() {
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

    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let currentX = mouseX;
    let currentY = mouseY;

    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    });

    function animate() {
      currentX += (mouseX - currentX) * 0.05;
      currentY += (mouseY - currentY) * 0.05;

      const offsetX = (currentX - window.innerWidth / 2) / window.innerWidth;
      const offsetY = (currentY - window.innerHeight / 2) / window.innerHeight;

      container.style.transform = `translate(${offsetX * 20}px, ${offsetY * 20}px)`;

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
