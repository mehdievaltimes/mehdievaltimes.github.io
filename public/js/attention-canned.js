(function() {
  const sentence = ["The", "quick", "brown", "fox", "jumps", "over", "the", "lazy", "dog"];
  const weights = [
    [1.0, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [0.2, 1.0, 0.6, 0.8, 0.1, 0.0, 0.0, 0.0, 0.0],
    [0.1, 0.5, 1.0, 0.9, 0.1, 0.0, 0.0, 0.0, 0.0],
    [0.3, 0.8, 0.9, 1.0, 0.6, 0.1, 0.1, 0.0, 0.0],
    [0.0, 0.1, 0.1, 0.8, 1.0, 0.7, 0.2, 0.5, 0.6],
    [0.0, 0.0, 0.0, 0.1, 0.6, 1.0, 0.3, 0.1, 0.4],
    [0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 1.0, 0.3, 0.6],
    [0.0, 0.0, 0.0, 0.0, 0.2, 0.1, 0.4, 1.0, 0.9],
    [0.0, 0.0, 0.0, 0.3, 0.7, 0.6, 0.8, 0.9, 1.0]
  ];

  const container = document.getElementById('attention-sandbox');
  if(!container) return;
  
  sentence.forEach((word, i) => {
    const span = document.createElement('span');
    span.className = 'word-token';
    span.innerText = word;
    
    span.addEventListener('mouseenter', () => {
      span.classList.add('active');
      const allTokens = container.querySelectorAll('.word-token');
      allTokens.forEach((otherToken, j) => {
        if (i !== j) {
          const w = weights[i][j];
          otherToken.style.backgroundColor = `rgb(var(--accent-rgb) / ${w})`;
          if(w > 0.5) otherToken.style.color = "var(--bg)";
        }
      });
    });
    
    span.addEventListener('mouseleave', () => {
      span.classList.remove('active');
      const allTokens = container.querySelectorAll('.word-token');
      allTokens.forEach((otherToken) => {
        otherToken.style.backgroundColor = '';
        otherToken.style.color = '';
      });
    });
    
    container.appendChild(span);
  });
})();
