document.addEventListener("DOMContentLoaded", function() {
    const numSheep = 4;
    const sheepEmoji = "🐑";
    
    for (let i = 0; i < numSheep; i++) {
        // slightly stagger the creation
        setTimeout(createSheep, i * 500);
    }
    
    function createSheep() {
        const sheep = document.createElement("div");
        sheep.innerText = sheepEmoji;
        sheep.style.position = "fixed";
        sheep.style.bottom = (5 + Math.random() * 15) + "px"; // slightly randomize vertical position
        sheep.style.fontSize = (25 + Math.random() * 10) + "px"; // randomize size
        sheep.style.zIndex = "9999";
        sheep.style.userSelect = "none";
        sheep.style.pointerEvents = "none";
        
        document.body.appendChild(sheep);
        
        let position = Math.random() * window.innerWidth;
        let direction = Math.random() > 0.5 ? 1 : -1;
        let speed = 0.3 + Math.random() * 0.8;
        
        let isGrazing = false;
        
        function animate() {
            if (!isGrazing) {
                position += speed * direction;
                
                // Wrap around edges
                if (position > window.innerWidth + 50) {
                    position = -50;
                } else if (position < -50) {
                    position = window.innerWidth + 50;
                }
                
                // The emoji faces left by default.
                // If direction is 1 (moving right), we need to flip it horizontally.
                sheep.style.transform = `translateX(${position}px) scaleX(${direction === 1 ? -1 : 1})`;
                
                // Randomly decide to graze (pause)
                if (Math.random() < 0.002) {
                    isGrazing = true;
                    // change to a slightly rotated state to look like eating?
                    sheep.style.transform = `translateX(${position}px) scaleX(${direction === 1 ? -1 : 1}) rotate(-15deg)`;
                    setTimeout(() => {
                        isGrazing = false;
                        // might change direction after grazing
                        if (Math.random() > 0.5) {
                            direction *= -1;
                        }
                    }, 2000 + Math.random() * 3000); // Graze for 2-5 seconds
                }
            }
            
            requestAnimationFrame(animate);
        }
        
        animate();
    }
});
