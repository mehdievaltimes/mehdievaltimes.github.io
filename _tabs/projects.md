---
layout: page
title: Projects
icon: fas fa-code
order: 2
---

Here are some of my recent open-source projects on GitHub.

<style>
  #github-projects .card {
    background: var(--card-bg, var(--main-bg));
    border-color: var(--card-border-color, var(--border-color));
    color: var(--text-color);
  }
  #github-projects .card-text, #github-projects .small {
    color: var(--text-muted) !important;
  }
</style>

<div id="github-projects" class="d-flex flex-wrap" style="gap: 1rem;">
  <!-- Projects will be loaded here via JS -->
  <p>Loading projects...</p>
</div>

<script>
document.addEventListener("DOMContentLoaded", function() {
    const username = "mehdievaltimes";
    const numRepos = 5;
    
    fetch(`https://api.github.com/users/${username}/repos?sort=updated&per_page=${numRepos}`)
        .then(response => response.json())
        .then(data => {
            const container = document.getElementById("github-projects");
            container.innerHTML = "";
            
            data.forEach(repo => {
                const card = document.createElement("div");
                card.className = "card";
                card.style.flex = "1 1 calc(50% - 1rem)";
                card.style.minWidth = "250px";
                
                card.innerHTML = `
                    <div class="card-body d-flex flex-column h-100">
                        <h4 class="card-title">
                            <a href="${repo.html_url}" target="_blank" rel="noopener noreferrer">${repo.name}</a>
                        </h4>
                        <p class="card-text text-muted flex-grow-1">${repo.description || "No description provided."}</p>
                        <div class="text-muted small mt-2">
                            <span class="me-3"><i class="far fa-star"></i> ${repo.stargazers_count}</span>
                            <span class="me-3"><i class="fas fa-code-branch"></i> ${repo.forks_count}</span>
                            <span><i class="fas fa-circle" style="color: #6e7681; font-size: 0.8em; vertical-align: baseline;"></i> ${repo.language || "Unknown"}</span>
                        </div>
                    </div>
                `;
                
                container.appendChild(card);
            });
        })
        .catch(error => {
            console.error("Error loading GitHub projects:", error);
            document.getElementById("github-projects").innerHTML = "<p>Failed to load projects. Please try again later.</p>";
        });
});
</script>
