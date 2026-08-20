(() => {
  const links = [...document.querySelectorAll('.side-nav a[href^="#"]')];
  if (!links.length || !('IntersectionObserver' in window)) return;

  const targets = links
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

    if (!visible) return;
    links.forEach((link) => {
      const active = link.getAttribute('href') === `#${visible.target.id}`;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  }, { rootMargin: '-96px 0px -55% 0px', threshold: [0.1, 0.35, 0.65] });

  targets.forEach((target) => observer.observe(target));
})();
