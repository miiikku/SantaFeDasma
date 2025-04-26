let inactivityTimer;

function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
        window.location.href = "/logout";
    }, 5 * 60 * 1000); // 5 minutes
}

document.addEventListener("mousemove", resetInactivityTimer);
document.addEventListener("keydown", resetInactivityTimer);

resetInactivityTimer();
