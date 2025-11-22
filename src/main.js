import './style.css';

const dayButtons = document.querySelectorAll('.day-button');
const daySections = document.querySelectorAll('.day-content');
const titleEl = document.getElementById('dayTitle');

function showDay(dayId, titleText) {
  daySections.forEach((section) => {
    section.classList.toggle('active', section.id === dayId);
  });

  if (titleEl && titleText) {
    titleEl.textContent = titleText;
  }
}

dayButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const day = btn.dataset.day;
    const title = btn.dataset.title;

    // active state for buttons
    dayButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    // show selected day's content
    showDay(day, title);
  });
});
