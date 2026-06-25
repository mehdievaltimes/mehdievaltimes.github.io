document.addEventListener("DOMContentLoaded", function() {
    const numSheep = 3;
    
    const sheepSvg = `
    <svg width="60" height="50" viewBox="0 0 60 50" xmlns="http://www.w3.org/2000/svg">
      <style>
        .leg { transform-origin: 50% 10%; }
        .leg-anim { animation: walk 0.5s infinite alternate ease-in-out; }
        .leg-anim-delay { animation: walk 0.5s infinite alternate-reverse ease-in-out; }
        .head-anim { animation: graze 4s infinite; transform-origin: 80% 50%; }
        @keyframes walk {
          0% { transform: rotate(-15deg); }
          100% { transform: rotate(15deg); }
        }
        @keyframes graze {
          0%, 100% { transform: rotate(0deg); }
          10%, 40% { transform: rotate(30deg) translate(-2px, 5px); }
          50%, 90% { transform: rotate(0deg); }
        }
      </style>
      <g class="sheep-body">
        <!-- Legs -->
        <rect class="leg leg-anim" x="15" y="30" width="4" height="15" rx="2" fill="#333"/>
        <rect class="leg leg-anim-delay" x="25" y="30" width="4" height="15" rx="2" fill="#333"/>
        <rect class="leg leg-anim" x="35" y="30" width="4" height="15" rx="2" fill="#333"/>
        <rect class="leg leg-anim-delay" x="45" y="30" width="4" height="15" rx="2" fill="#333"/>
        
        <!-- Body (Fluffy wool) -->
        <path d="M 15 25 C 10 25, 10 15, 20 15 C 25 5, 40 5, 45 15 C 55 15, 55 25, 50 25 C 55 35, 45 40, 35 35 C 30 40, 20 40, 15 35 C 5 35, 5 25, 15 25 Z" fill="#fdfdfd" stroke="#dcdcdc" stroke-width="2"/>
        
        <!-- Head -->
        <g class="head">
          <ellipse cx="50" cy="20" rx="8" ry="10" fill="#222"/>
          <!-- Ear -->
          <ellipse cx="43" cy="17" rx="5" ry="2.5" fill="#222" transform="rotate(20 43 17)"/>
          <!-- Eye -->
          <circle cx="53" cy="18" r="1.5" fill="#fff"/>
        </g>
      </g>
    </svg>
    `;

    for (let i = 0; i < numSheep; i++) {
        setTimeout(createSheep, i * 800);
    }
    
    function createSheep() {
        const sheep = document.createElement("div");
        sheep.innerHTML = sheepSvg;
        sheep.style.position = "fixed";
        sheep.style.top = Math.random() * (window.innerHeight - 50) + "px";
        sheep.style.zIndex = "9999";
        sheep.style.userSelect = "none";
        sheep.style.pointerEvents = "none";
        // To make sure it doesn't cause horizontal scrollbar issues
        sheep.style.width = "60px";
        sheep.style.height = "50px";
        
        document.body.appendChild(sheep);
        
        let position = Math.random() * window.innerWidth;
        let direction = Math.random() > 0.5 ? 1 : -1;
        let speed = 0.4 + Math.random() * 0.4;
        
        let isGrazing = false;
        
        const head = sheep.querySelector('.head');
        const legs = sheep.querySelectorAll('.leg');
        
        function animate() {
            if (!isGrazing) {
                position += speed * direction;
                
                if (position > window.innerWidth + 50) {
                    position = -60;
                } else if (position < -60) {
                    position = window.innerWidth + 50;
                }
                
                // SVG faces right naturally, so if direction is 1, scaleX(1). 
                // If direction is -1 (left), scaleX(-1)
                sheep.style.transform = `translateX(${position}px) scaleX(${direction === 1 ? 1 : -1})`;
                
                if (Math.random() < 0.002) {
                    isGrazing = true;
                    // Stop walking animation
                    legs.forEach(l => l.style.animationPlayState = 'paused');
                    // Start grazing animation
                    head.classList.add('head-anim');
                    
                    setTimeout(() => {
                        isGrazing = false;
                        legs.forEach(l => l.style.animationPlayState = 'running');
                        head.classList.remove('head-anim');
                        if (Math.random() > 0.5) direction *= -1;
                    }, 3000 + Math.random() * 4000);
                }
            }
            
            requestAnimationFrame(animate);
        }
        
        // initial state
        head.classList.remove('head-anim');
        animate();
    }
});
