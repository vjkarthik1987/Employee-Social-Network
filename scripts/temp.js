<script>
(function(){
  const org = "<%= company.slug %>";
  const postId = "<%= post._id %>";
  const commentsCountEl = document.getElementById('comments-count'); // present inside _reactions_bar totals
  const list = document.getElementById('comments-list');

  function bumpCommentsCount(delta){
    if (!commentsCountEl) return;
    const n = parseInt(commentsCountEl.textContent || '0', 10) + (delta || 0);
    commentsCountEl.textContent = Math.max(0, n);
  }

  // Submit top-level comment (AJAX)
  const newForm = document.getElementById('new-comment-form');
  if (newForm) {
    newForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = new URLSearchParams(new FormData(newForm));

      const resp = await fetch(newForm.action, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body
      });
      const data = await resp.json();
      if (!data.ok) return alert('Could not add comment.');
      const temp = document.createElement('div');
      temp.innerHTML = data.html.trim();
      const li = temp.firstElementChild;
      if (li) list.appendChild(li);
      bumpCommentsCount(data.commentsCountDelta || 0);
      newForm.reset();
    });
  }

 // Delegate: Reply toggle + Delete (comment/reply)
document.addEventListener('click', async (e) => {
  // --- Reply toggle (robust with "closest") ---
  const replyToggle = e.target.closest('[data-reply-toggle]');
  if (replyToggle) {
    e.preventDefault();
    const id = replyToggle.getAttribute('data-reply-toggle');
    const el = document.getElementById('reply-form-' + id);
    if (el) {
      const willShow = (el.style.display === 'none' || !el.style.display);
      el.style.display = willShow ? 'block' : 'none';
      if (willShow) {
        const ta = el.querySelector('.cc-input');
        if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
        // bindComposer(el); // only if you're using that function
      }
    }
    return;
  }

  // --- Delete (unchanged) ---
  const delBtn = e.target.closest('[data-ajax-delete]');
  if (delBtn) {
    e.preventDefault();
    const commentId = delBtn.getAttribute('data-comment-id');
    if (!commentId) return;
    if (!confirm('Delete this comment?')) return;
    const url = `/${org}/api/comments/${commentId}`;
    const resp = await fetch(url, { method: 'DELETE', headers: { 'Accept': 'application/json' } });
    const data = await resp.json();
    if (!data.ok) return alert('Delete failed');

    const selector = data.isReply ? `[data-reply-id="${data.commentId}"]`
                                  : `[data-comment-id="${data.commentId}"]`;
    const node = document.querySelector(selector);
    if (node) {
      const content = node.querySelector('.comment-content');
      if (content) content.innerHTML = '<em style="color:#888;">(deleted)</em>';
      const delBtn = node.querySelector('[data-ajax-delete]'); if (delBtn) delBtn.remove();
    }
    bumpCommentsCount(data.commentsCountDelta || 0);
  }
});

  // Delegate: reply form submit (has data-ajax-reply)
  document.addEventListener('submit', async (e) => {
    const f = e.target;
    if (!f.matches('[data-ajax-reply]')) return;
    e.preventDefault();
    const fd = new FormData(f);
    const resp = await fetch(f.action, { method: 'POST', body: fd, headers: { 'Accept': 'application/json' } });
    const data = await resp.json();
    if (!data.ok) return alert('Could not add reply.');
    const parentId = data.parentCommentId;
    const container = document.querySelector(`[data-comment-id="${parentId}"] [data-replies]`);
    if (container) {
      container.style.display = 'block';
      const temp = document.createElement('div');
      temp.innerHTML = data.html.trim();
      const li = temp.firstElementChild;
      if (li) container.appendChild(li);
    }
    bumpCommentsCount(data.commentsCountDelta || 0);
    f.reset();
    f.style.display = 'none';
  });
})();
</script>
<script>
  (function(){
    // auto-resize, counters, enable/disable send, ctrl+enter
    // function bindComposer(root){
    //   const ta = root.querySelector('.cc-input');
    //   const count = root.querySelector('[data-cc-count]');
    //   const send = root.querySelector('.send-btn');
    //   if (!ta) return;
  
    //   const max = parseInt(ta.getAttribute('maxlength') || '3000', 10);
  
    //   const autosize = () => {
    //     ta.style.height = 'auto';
    //     ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    //   };
  
    //   const updateUI = () => {
    //     const val = ta.value.trim();
    //     if (count) count.textContent = `${ta.value.length}/${max}`;
    //     if (send) send.disabled = !val.length;
    //   };
  
    //   ta.addEventListener('input', () => { autosize(); updateUI(); });
    //   ta.addEventListener('keydown', (e) => {
    //     // Ignore IME composition (important for Indian languages, etc.)
    //     if (e.isComposing) return;

    //     // Shift+Enter → newline (let it through)
    //     if (e.key === 'Enter' && e.shiftKey) return;

    //     // Plain Enter → submit (no Ctrl/Meta)
    //     if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    //       e.preventDefault(); // stop newline
    //       const form = ta.closest('form');
    //       const sendBtn = form?.querySelector('.cc-send');
    //       if (form && sendBtn && !sendBtn.disabled) {
    //         // Triggers your existing submit listeners (AJAX)
    //         form.requestSubmit();
    //       }
    //     }
    //   });

  
    //   // initial
    //   autosize(); updateUI();
    // }
  
    // bind top-level composer
    const topForm = document.getElementById('new-comment-form');
    if (topForm) bindComposer(topForm);
  
    // bind any visible reply composers on load
    document.querySelectorAll('.reply-form').forEach(bindComposer);
  
    // when a reply form is toggled to visible, (re)bind it
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-reply-toggle]');
      if (!t) return;
      const id = t.getAttribute('data-reply-toggle');
      const form = document.getElementById('reply-form-' + id);
      if (!form) return;
      setTimeout(() => bindComposer(form), 0);
    });
  
    // after AJAX insert of a freshly rendered comment/reply, ensure any nested composer is bound if present
    document.addEventListener('cc:bind', (e) => {
      if (e.target) bindComposer(e.target);
    });
  })();
  </script>

<script>
  (function(){
    // === scoped to comments-area ===
    const root = document.querySelector('.comments-area');
    if (!root) return;
  
    function bindComposer(form){
      const ta = form.querySelector('.cc-input');
      const cnt = form.querySelector('[data-cc-count]');
      const send = form.querySelector('.cc-send');
      const emojiBtn = form.querySelector('.cc-emoji-btn');
      if (!ta) return;
  
      const max = parseInt(ta.getAttribute('maxlength') || '3000', 10);
  
      const autosize = () => { ta.style.height='auto'; ta.style.height = Math.min(ta.scrollHeight,160)+'px'; };
      const refresh  = () => {
        const len = ta.value.length;
        if (cnt) cnt.textContent = `${len}/${max}`;
        if (send) send.disabled = ta.value.trim().length === 0;
      };
  
      ta.addEventListener('input', () => { autosize(); refresh(); });
      // ta.addEventListener('keydown', (e) => {
      //   if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      //     if (send && !send.disabled) form.requestSubmit();
      //   }
      // });
  
      // simple emoji insert (placeholder for real picker later)
      if (emojiBtn) {
        emojiBtn.addEventListener('click', () => {
          const emoji = '🙂';
          const start = ta.selectionStart ?? ta.value.length;
          const end   = ta.selectionEnd ?? ta.value.length;
          ta.value = ta.value.slice(0, start) + emoji + ta.value.slice(end);
          ta.focus();
          ta.selectionStart = ta.selectionEnd = start + emoji.length;
          autosize(); refresh();
        });
      }
  
      // init
      autosize(); refresh();
    }
  
    // bind top composer
    const topForm = document.getElementById('new-comment-form');
    if (topForm) bindComposer(topForm);
  
    // bind visible reply composers now
    root.querySelectorAll('.cc-reply').forEach(bindComposer);
  
    // when a reply form is toggled open, bind it
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-reply-toggle]');
      if (!t) return;
      const id = t.getAttribute('data-reply-toggle');
      const form = document.getElementById('reply-form-' + id);
      if (form) setTimeout(() => bindComposer(form), 0);
    });
  
    // (Optional) if you AJAX-insert new composers later, dispatch this to bind:
    // node.dispatchEvent(new CustomEvent('cc:bind', { bubbles:true }));
    document.addEventListener('cc:bind', (e) => {
      const form = e.target.closest('.cc-composer, .cc-reply');
      if (form) bindComposer(form);
    });

    ta.addEventListener('keydown', (e) => {
    // Ignore while IME is composing characters
    if (e.isComposing) return;

    // Submit on Enter
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();  // stop newline
      const form = ta.closest('form');
      const sendBtn = form?.querySelector('.cc-send');
      if (form && sendBtn && !sendBtn.disabled) {
        form.requestSubmit();
      }
      return;
    }

    // Allow Shift+Enter to insert a newline
  });


    
  })();
  </script>