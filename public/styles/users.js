document.addEventListener('DOMContentLoaded', function () {
    // Event listener for notification icon
    const notifIcon = document.getElementById('notif-icon');
    if (notifIcon) {
        notifIcon.addEventListener('click', function (event) {
            event.preventDefault();
            toggleNotifPopup();
        });
    }

    // Event listener for user icon
    const userIcon = document.getElementById('user-icon');
    if (userIcon) {
        userIcon.addEventListener('click', function (event) {
            event.preventDefault();
            toggleUserPopup();
        });
    }

    // Event listener for form submission
    const requestForm = document.querySelector('form');
    if (requestForm) {
        requestForm.addEventListener('submit', function (event) {
            event.preventDefault();
        });
    }

    // Fetch user details and populate form fields
    if (typeof fetchUserDetails === 'function') {
        fetchUserDetails();
    }
});

function toggleNotifPopup() {
    const notifPopup = document.getElementById('notif-popup');
    const userPopup = document.getElementById('user-popup');
    if (userPopup && userPopup.classList.contains('show')) {
        userPopup.classList.remove('show');
    }
    if (notifPopup) {
        notifPopup.classList.toggle('show');
    }
}

function toggleUserPopup() {
    const userPopup = document.getElementById('user-popup');
    const notifPopup = document.getElementById('notif-popup');
    if (notifPopup && notifPopup.classList.contains('show')) {
        notifPopup.classList.remove('show');
    }
    if (userPopup) {
        userPopup.classList.toggle('show');
    }
}

function deleteNotif(element) {
    const notifItem = element.closest('.notif-item');
    if (notifItem) {
        notifItem.remove();
    }
}

document.addEventListener('DOMContentLoaded', function () {
    // Other existing event listeners...

    // Event listener for logout
    const logoutLink = document.querySelector('a[href="/logout"]');
    if (logoutLink) {
        logoutLink.addEventListener('click', function (event) {
            event.preventDefault();
            window.location.href = '/logout';
        });
    }
});

// FOR REQUEST-DOCUMENT.HTML
document.addEventListener('DOMContentLoaded', function () {
    // Get elements by class name
    const certificateCard = document.querySelector('.certificatecard');
    const clearanceCard = document.querySelector('.clearancecard');
    const indigencyCard = document.querySelector('.indigencycard');

    // Add event listeners for navigation
    certificateCard.addEventListener('click', function () {
        window.location.href = 'request-document-cert.html';
    });

    clearanceCard.addEventListener('click', function () {
        window.location.href = 'request-document-clear.html';
    });

    indigencyCard.addEventListener('click', function () {
        window.location.href = 'request-document-indi.html';
    });
});

// User profile popup kka add lang: april 18
  // Function to toggle the user popup visibility
function toggleUserPopup() {
    const userPopup = document.getElementById('user-popup');
    userPopup.classList.toggle('hidden'); // Toggle visibility on click
}

// Close the popup if click is outside of the user popup
document.addEventListener('click', function(event) {
    const userPopup = document.getElementById('user-popup');
    const userIcon = document.getElementById('user-icon-large');
    const userIconSmall = document.getElementById('user-icon-small');

    // If the click is outside the popup and the user icon, close the popup
    if (
        !userPopup.contains(event.target) && 
        event.target !== userIcon && 
        !userIcon.contains(event.target) && 
        event.target !== userIconSmall && 
        !userIconSmall.contains(event.target)
    ) {
        userPopup.classList.add('hidden');
    }
});

// Add event listener to toggle the popup when the user icon is clicked (large screen)
document.getElementById('user-icon-large').addEventListener('click', function(event) {
    event.preventDefault();  // Prevent the default action of the anchor tag
    toggleUserPopup();  // Toggle the visibility of the user popup
});

// Add event listener to toggle the popup when the user icon is clicked (small screen)
document.getElementById('user-icon-small').addEventListener('click', function(event) {
    event.preventDefault();  // Prevent the default action of the anchor tag
    toggleUserPopup();  // Toggle the visibility of the user popup
});

