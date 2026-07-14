// Support Page Logic
const CONFIG = {
  paypalUrl: 'https://www.paypal.com/paypalme/arunbanakar123',
  githubUrl: 'https://github.com/arunbanakar123/URLBlast'
};

async function init() {
  // Set PayPal link
  const ppLink = document.getElementById('paypal-link');
  if (ppLink) ppLink.href = CONFIG.paypalUrl;

  // Set GitHub link
  const ghLink = document.getElementById('gh-link');
  if (ghLink) ghLink.href = CONFIG.githubUrl;
}

// Back link
const backLink = document.getElementById('back-link');
if (backLink) {
  backLink.addEventListener('click', (e) => {
    e.preventDefault();
    window.close();
  });
}

init();
