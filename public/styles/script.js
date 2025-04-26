// Toggle Dropdown
function toggleDropdown() {
    var dropdown = document.getElementById("myDropdown");
    if (dropdown) {
        dropdown.classList.toggle("show");
    } else {
        console.error("Dropdown element not found");
    }
}

// Close the dropdown if the user clicks outside of it
window.onclick = function(event) {
    if (!event.target.matches('.dropbtn')) {
        var dropdowns = document.getElementsByClassName("dropdown-content");
        for (var i = 0; i < dropdowns.length; i++) {
            var openDropdown = dropdowns[i];
            if (openDropdown.classList.contains('show')) {
                openDropdown.classList.remove('show');
            }
        }
    }
}

// Logout function for user-side
function logout() {
    fetch('/logout', {
        method: 'GET',
        credentials: 'same-origin'
    })
    .then(response => {
        if (response.ok) {
            window.location.href = '/';
        } else {
            console.error('Logout failed');
        }
    })
    .catch(error => {
        console.error('Error during logout:', error);
    });
}

// Navigation
function navigateToPage(select) {
    const page = select.value;
    window.location.href = page;
}

// Add Modal
function openModal() {
    document.getElementById("addModal").style.display = "block";
}

function closeModal() {
    document.getElementById("addModal").style.display = "none";
}

function submitForm() {
    // Add your form submission logic here
    alert("Form submitted");
    closeModal();
}

// Function to encode data to URL parameters
function encodeParams(data) {
    return Object.keys(data).map(key => encodeURIComponent(key) + '=' + encodeURIComponent(data[key])).join('&');
}

// Function to navigate to the certificate page with data
function navigateToCertificate(data) {
    const params = encodeParams(data);
    window.location.href = `certificate-justice-system.html?${params}`;
}

// Add event listener to the red icon for navigation
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.generate-certificate-icon').forEach(icon => {
        icon.addEventListener('click', function(event) {
            const row = event.target.closest('tr');
            const data = {
                caseNumber: row.cells[0].innerText,
                dateIssued: row.cells[1].innerText,
                complainantName: row.cells[2].innerText,
                complaineeName: row.cells[3].innerText,
                hearingStage: row.cells[4].innerText,
                hearingDate: row.cells[5].innerText,
                dateDescription: row.cells[6].innerText,
            };
            navigateToCertificate(data);
        });
    });
});

document.addEventListener('DOMContentLoaded', function() {
    if (window.location.pathname.endsWith('official-account.html')) {
        fetchOfficialAccounts();
    }
});

document.addEventListener('DOMContentLoaded', function() {
    if (window.location.pathname.endsWith('residents.html')) {
        fetchResidents();
    }
});

document.addEventListener('DOMContentLoaded', function() {
    if (window.location.pathname.endsWith('barangay-id.html')) {
        fetchBarangayIds();
    }
});

//kka add lang April: 17
//Admin Profile Popup
// Toggle Dropdown (Dropdown function)
function toggleDropdown() {
    var popup = document.getElementById("user-popup");
    popup.classList.toggle("hidden");
}

// Close the dropdown if the user clicks outside of it
window.onclick = function(event) {
    var popup = document.getElementById("user-popup");
    if (!event.target.closest('.dropdown') && !event.target.matches('.dropbtn')) {
        if (popup && !popup.classList.contains('hidden')) {
            popup.classList.add('hidden');
        }
    }
}
