(function () {
  const fileInput = document.getElementById('file');
  const uploadBtn = document.getElementById('uploadBtn');
  const uploadError = document.getElementById('uploadError');
  const previewSection = document.getElementById('previewSection');
  const summaryEl = document.getElementById('summary');
  const dryRunCheckbox = document.getElementById('dryRun');
  const sendAllBtn = document.getElementById('sendAllBtn');
  const previewEl = document.getElementById('preview');
  const sendStatusEl = document.getElementById('sendStatus');

  let uploadResult = null;

  function showError(el, msg) {
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  }

  uploadBtn.addEventListener('click', async function () {
    const file = fileInput.files && fileInput.files[0];
    uploadError.textContent = '';
    if (!file) {
      uploadError.textContent = 'Please select a file.';
      return;
    }
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      uploadError.textContent = 'Only .xlsx files are allowed.';
      return;
    }

    uploadBtn.disabled = true;
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        uploadError.textContent = data.error || 'Upload failed.';
        return;
      }
      uploadResult = data;
      previewSection.style.display = 'block';
      summaryEl.textContent = data.totalUsers + ' users from ' + (data.universities && data.universities.length) + ' universities.';
      renderPreview(data);
      sendStatusEl.textContent = '';
    } finally {
      uploadBtn.disabled = false;
    }
  });

  function renderPreview(data) {
    const byUniversity = data.byUniversity || {};
    const universities = data.universities || [];
    let html = '';
    universities.forEach(function (uni) {
      const users = byUniversity[uni] || [];
      html += '<div class="university-block" data-university="' + escapeHtml(uni) + '">';
      html += '<h3>' + escapeHtml(uni) + ' (' + users.length + ' users)</h3>';
      html += '<button type="button" class="sendUniBtn">Send to this university</button>';
      html += '<table><thead><tr><th>Phone</th><th>City</th><th>Link</th><th>Message 1</th></tr></thead><tbody>';
      users.forEach(function (u) {
        const msg1 = (u.sequence && u.sequence[0]) ? u.sequence[0] : '';
        const preview = msg1.length > 50 ? msg1.slice(0, 47) + '...' : msg1;
        const linkPreview = (u.link || '').length > 40 ? (u.link || '').slice(0, 37) + '...' : (u.link || '');
        html += '<tr><td>' + escapeHtml(u.phone) + '</td><td>' + escapeHtml(u.city) + '</td><td>' + escapeHtml(linkPreview) + '</td><td>' + escapeHtml(preview) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    });
    previewEl.innerHTML = html;

    previewEl.querySelectorAll('.sendUniBtn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const block = btn.closest('.university-block');
        const uni = block && block.getAttribute('data-university');
        if (uni && uploadResult && uploadResult.byUniversity[uni]) {
          sendUsers(uploadResult.byUniversity[uni], uni);
        }
      });
    });
  }

  sendAllBtn.addEventListener('click', function () {
    if (uploadResult && uploadResult.users) {
      sendUsers(uploadResult.users, null);
    }
  });

  async function sendUsers(users, university) {
    if (!users || !users.length) return;
    sendAllBtn.disabled = true;
    previewEl.querySelectorAll('.sendUniBtn').forEach(function (b) { b.disabled = true; });
    sendStatusEl.textContent = 'Starting campaign (sending message 1)...';
    sendStatusEl.className = 'status';

    try {
      const res = await fetch('/api/campaign/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ users: users }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        sendStatusEl.textContent = 'Started ' + (data.startedUsers || 0) + ' conversations. Reply on WhatsApp to receive the next messages.';
        sendStatusEl.className = 'status success';
      } else {
        sendStatusEl.textContent = data.error || 'Campaign start failed.';
        sendStatusEl.className = 'status error';
      }
    } catch (err) {
      sendStatusEl.textContent = err.message || 'Request failed.';
      sendStatusEl.className = 'status error';
    } finally {
      sendAllBtn.disabled = false;
      previewEl.querySelectorAll('.sendUniBtn').forEach(function (b) { b.disabled = false; });
    }
  }

  function escapeHtml(s) {
    if (s == null) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }
})();
