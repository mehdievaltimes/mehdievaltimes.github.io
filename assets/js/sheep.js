document.addEventListener("DOMContentLoaded", function() {
    const numSheep = 15;
    
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
        sheep.style.pointerEvents = "auto";
        sheep.style.cursor = "grab";
        sheep.style.width = "60px";
        sheep.style.height = "50px";
        
        document.body.appendChild(sheep);
        
        let position = Math.random() * window.innerWidth;
        let direction = Math.random() > 0.5 ? 1 : -1;
        let speed = 0.4 + Math.random() * 0.4;
        
        let isGrazing = false;
        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;
        let isClick = false; 
        
        const head = sheep.querySelector('.head');
        const legs = sheep.querySelectorAll('.leg');
        
        sheep.addEventListener('mousedown', (e) => {
            isDragging = true;
            isClick = true;
            sheep.style.cursor = "grabbing";
            
            const rect = sheep.getBoundingClientRect();
            dragOffsetX = e.clientX - position;
            dragOffsetY = e.clientY - rect.top;
            
            // Wiggle legs fast while dragged
            legs.forEach(l => {
                l.style.animationDuration = "0.15s";
                l.style.animationPlayState = 'running';
            });
            head.classList.remove('head-anim');
            isGrazing = false;
            
            e.preventDefault(); // Prevent text selection
        });
        
        window.addEventListener('mousemove', (e) => {
            if (isDragging) {
                isClick = false; 
                position = e.clientX - dragOffsetX;
                let newTop = e.clientY - dragOffsetY;
                
                if (newTop < 0) newTop = 0;
                if (newTop > window.innerHeight - 50) newTop = window.innerHeight - 50;
                
                sheep.style.top = newTop + "px";
                sheep.style.transform = `translateX(${position}px) scaleX(${direction === 1 ? 1 : -1})`;
            }
        });
        
        window.addEventListener('mouseup', (e) => {
            if (isDragging) {
                isDragging = false;
                sheep.style.cursor = "grab";
                
                legs.forEach(l => l.style.animationDuration = "0.5s");
                
                if (isClick) {
                    const utterance = new SpeechSynthesisUtterance("baaa");
                    utterance.pitch = 1.5 + Math.random() * 0.5;
                    utterance.rate = 0.8;
                    window.speechSynthesis.speak(utterance);
                    
                    sheep.style.transition = "transform 0.1s ease-out";
                    sheep.style.transform = `translateX(${position}px) translateY(-20px) scaleX(${direction === 1 ? 1 : -1})`;
                    setTimeout(() => {
                        sheep.style.transform = `translateX(${position}px) scaleX(${direction === 1 ? 1 : -1})`;
                        setTimeout(() => { sheep.style.transition = ""; }, 100);
                    }, 100);
                }
            }
        });
        
        function animate() {
            if (!isGrazing && !isDragging) {
                position += speed * direction;
                
                if (position > window.innerWidth + 50) {
                    position = -60;
                } else if (position < -60) {
                    position = window.innerWidth + 50;
                }
                
                sheep.style.transform = `translateX(${position}px) scaleX(${direction === 1 ? 1 : -1})`;
                
                if (Math.random() < 0.002) {
                    isGrazing = true;
                    legs.forEach(l => l.style.animationPlayState = 'paused');
                    head.classList.add('head-anim');
                    
                    setTimeout(() => {
                        isGrazing = false;
                        if (!isDragging) {
                            legs.forEach(l => l.style.animationPlayState = 'running');
                        }
                        head.classList.remove('head-anim');
                        if (Math.random() > 0.5) direction *= -1;
                    }, 3000 + Math.random() * 4000);
                }
            }
            
            requestAnimationFrame(animate);
        }
        
        head.classList.remove('head-anim');
        animate();
    }
});
