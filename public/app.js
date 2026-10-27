const app = document.getElementById('app');
const nav = document.getElementById('nav');
const toastEl = document.getElementById('toast');

const state = {
  token: localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  feed: 'all',
};

// ---------- helpers ----------
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c != null) node.append(c);
  }
  return node;
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2200);
}

async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) logout(true);
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function timeAgo(sqlDate) {
  const d = new Date(sqlDate.replace(' ', 'T') + 'Z');
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return d.toLocaleDateString();
}

function saveSession(data) {
  state.token = data.token;
  state.user = data.user;
  localStorage.setItem('token', data.token);
  localStorage.setItem('user', JSON.stringify(data.user));
}

function logout(expired = false) {
  state.token = null;
  state.user = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  if (expired) toast('Session expired, please log in again');
  location.hash = '#/login';
  renderNav();
}

// ---------- nav ----------
function renderNav() {
  nav.replaceChildren();
  if (state.user) {
    nav.append(
      el('a', { href: '#/u/' + state.user.username, class: 'btn small', text: state.user.username }),
      el('button', { class: 'btn small ghost', text: 'Log out', onclick: () => logout() })
    );
  } else {
    nav.append(
      el('a', { href: '#/login', class: 'btn small', text: 'Log in' }),
      el('a', { href: '#/register', class: 'btn small primary', text: 'Sign up' })
    );
  }
}

// ---------- auth pages ----------
function authPage(mode) {
  const isReg = mode === 'register';
  const err = el('p', { class: 'error' });
  const username = el('input', { name: 'username', autocomplete: 'username', required: '' });
  const email = el('input', { name: 'email', type: 'email', autocomplete: 'email', required: '' });
  const password = el('input', {
    name: 'password', type: 'password', required: '',
    autocomplete: isReg ? 'new-password' : 'current-password',
  });

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      try {
        const body = isReg
          ? { username: username.value, email: email.value, password: password.value }
          : { username: username.value, password: password.value };
        saveSession(await api('/auth/' + mode, 'POST', body));
        renderNav();
        location.hash = '#/';
      } catch (ex) {
        err.textContent = ex.message;
      }
    },
  },
    el('label', { class: 'field' }, el('span', { text: 'Username' }), username),
    isReg ? el('label', { class: 'field' }, el('span', { text: 'Email' }), email) : null,
    el('label', { class: 'field' }, el('span', { text: 'Password' }), password),
    err,
    el('button', { class: 'btn primary', type: 'submit', text: isReg ? 'Create account' : 'Log in' })
  );

  const other = isReg
    ? ['Already have an account? ', el('a', { href: '#/login', text: 'Log in' })]
    : ['New here? ', el('a', { href: '#/register', text: 'Create an account' })];

  app.replaceChildren(
    el('div', { class: 'card' },
      el('h1', { text: isReg ? 'Join Chaupal' : 'Welcome back' }),
      form,
      el('p', { class: 'switch' }, ...other)
    )
  );
}

// ---------- post card ----------
function postCard(post, onDeleted) {
  const likeBtn = el('button', { class: 'act' + (post.liked ? ' liked' : '') });
  const commentBtn = el('button', { class: 'act' });
  const commentsBox = el('div', { class: 'comments', hidden: '' });
  let commentCount = post.comment_count;

  const paintLike = () => {
    likeBtn.textContent = (post.liked ? '♥ ' : '♡ ') + post.like_count;
    likeBtn.classList.toggle('liked', post.liked);
    likeBtn.setAttribute('aria-label', post.liked ? 'Unlike' : 'Like');
  };
  const paintComments = () => { commentBtn.textContent = '💬 ' + commentCount; };
  paintLike();
  paintComments();

  likeBtn.addEventListener('click', async () => {
    if (!state.user) return (location.hash = '#/login');
    try {
      const r = await api(`/posts/${post.id}/like`, 'POST');
      post.liked = r.liked;
      post.like_count = r.like_count;
      paintLike();
    } catch (ex) { toast(ex.message); }
  });

  commentBtn.addEventListener('click', async () => {
    if (!commentsBox.hidden) { commentsBox.hidden = true; return; }
    commentsBox.hidden = false;
    await loadComments();
  });

  async function loadComments() {
    const list = await api(`/posts/${post.id}/comments`);
    commentsBox.replaceChildren(
      ...list.map((c) =>
        el('div', { class: 'comment' }, el('b', { text: c.username }), el('span', { text: c.content }))
      )
    );
    if (state.user) {
      const input = el('input', { placeholder: 'Write a comment', maxlength: '200', 'aria-label': 'Comment' });
      commentsBox.append(
        el('form', {
          class: 'comment-form',
          onsubmit: async (e) => {
            e.preventDefault();
            if (!input.value.trim()) return;
            try {
              await api(`/posts/${post.id}/comments`, 'POST', { content: input.value });
              commentCount++;
              paintComments();
              await loadComments();
            } catch (ex) { toast(ex.message); }
          },
        }, input, el('button', { class: 'btn small primary', type: 'submit', text: 'Reply' }))
      );
    } else {
      commentsBox.append(el('a', { href: '#/login', text: 'Log in to comment' }));
    }
  }

  const actions = el('div', { class: 'actions' }, likeBtn, commentBtn);
  if (state.user && state.user.id === post.user_id) {
    actions.append(
      el('button', {
        class: 'act del', text: 'Delete',
        onclick: async () => {
          if (!confirm('Delete this post?')) return;
          try {
            await api('/posts/' + post.id, 'DELETE');
            onDeleted();
          } catch (ex) { toast(ex.message); }
        },
      })
    );
  }

  return el('article', { class: 'card' },
    el('div', { class: 'post-head' },
      el('a', { class: 'author', href: '#/u/' + post.username, text: post.username }),
      el('span', { class: 'time', text: timeAgo(post.created_at) })
    ),
    el('p', { class: 'post-body', text: post.content }),
    actions,
    commentsBox
  );
}

function renderPosts(container, posts, reload) {
  container.replaceChildren();
  if (!posts.length) {
    container.append(el('p', { class: 'empty', text: 'No posts here yet.' }));
    return;
  }
  posts.forEach((p) => container.append(postCard(p, reload)));
}

// ---------- home feed ----------
async function homePage() {
  const list = el('div');
  const tabAll = el('button', { class: 'tab', role: 'tab', text: 'Everyone' });
  const tabFollowing = el('button', { class: 'tab', role: 'tab', text: 'Following' });

  async function load() {
    tabAll.setAttribute('aria-selected', state.feed === 'all');
    tabFollowing.setAttribute('aria-selected', state.feed === 'following');
    const posts = await api('/posts' + (state.feed === 'following' ? '?feed=following' : ''));
    renderPosts(list, posts, load);
    if (state.feed === 'following' && !posts.length) {
      list.replaceChildren(el('p', { class: 'empty', text: 'Follow people to see their posts here.' }));
    }
  }

  tabAll.onclick = () => { state.feed = 'all'; load(); };
  tabFollowing.onclick = () => {
    if (!state.user) return (location.hash = '#/login');
    state.feed = 'following';
    load();
  };

  const parts = [];
  if (state.user) {
    const ta = el('textarea', { maxlength: '280', placeholder: "What's happening?", 'aria-label': 'New post' });
    const count = el('span', { class: 'count', text: '280' });
    ta.addEventListener('input', () => { count.textContent = 280 - ta.value.length; });
    parts.push(
      el('form', {
        class: 'card',
        onsubmit: async (e) => {
          e.preventDefault();
          if (!ta.value.trim()) return;
          try {
            await api('/posts', 'POST', { content: ta.value });
            ta.value = '';
            count.textContent = '280';
            load();
          } catch (ex) { toast(ex.message); }
        },
      }, ta,
        el('div', { class: 'composer-foot' }, count,
          el('button', { class: 'btn primary', type: 'submit', text: 'Post' })))
    );
  } else {
    parts.push(el('div', { class: 'card' },
      el('h2', { text: 'Chaupal' }),
      el('p', {}, el('a', { href: '#/register', text: 'Create an account' }), ' to post, like and follow.')));
  }
  parts.push(el('div', { class: 'tabs', role: 'tablist' }, tabAll, tabFollowing), list);
  app.replaceChildren(...parts);
  await load();
}

// ---------- profile ----------
async function profilePage(username) {
  let profile;
  try {
    profile = await api('/users/' + encodeURIComponent(username));
  } catch (ex) {
    app.replaceChildren(el('p', { class: 'empty', text: ex.message }));
    return;
  }

  const followers = el('b', { text: profile.followers });
  const bio = el('p', { class: 'bio', text: profile.bio || (profile.isMe ? 'Add a bio.' : 'No bio yet.') });

  let action = null;
  if (profile.isMe) {
    action = el('button', {
      class: 'btn small', text: 'Edit bio',
      onclick: async () => {
        const next = prompt('Your bio (max 160 characters)', profile.bio || '');
        if (next === null) return;
        try {
          const r = await api('/users/me', 'PUT', { bio: next });
          profile.bio = r.bio;
          bio.textContent = r.bio || 'Add a bio.';
        } catch (ex) { toast(ex.message); }
      },
    });
  } else {
    const btn = el('button', { class: 'btn small' });
    const paint = () => {
      btn.textContent = profile.isFollowing ? 'Following' : 'Follow';
      btn.classList.toggle('primary', !profile.isFollowing);
    };
    paint();
    btn.onclick = async () => {
      if (!state.user) return (location.hash = '#/login');
      try {
        const r = await api(`/users/${profile.id}/follow`, 'POST');
        profile.isFollowing = r.following;
        followers.textContent = r.followers;
        paint();
      } catch (ex) { toast(ex.message); }
    };
    action = btn;
  }

  const postsBox = el('div');
  renderPosts(postsBox, profile.posts, () => profilePage(username));

  app.replaceChildren(
    el('div', { class: 'card' },
      el('div', { class: 'profile-head' },
        el('div', {}, el('h1', { text: profile.username }), bio),
        action),
      el('div', { class: 'stats' },
        el('span', {}, followers, ' followers'),
        el('span', {}, el('b', { text: profile.following }), ' following'),
        el('span', {}, el('b', { text: profile.posts.length }), ' posts'))
    ),
    postsBox
  );
}

// ---------- router ----------
function route() {
  const hash = location.hash || '#/';
  renderNav();
  if (hash === '#/login') return authPage('login');
  if (hash === '#/register') return authPage('register');
  if (hash.startsWith('#/u/')) return profilePage(decodeURIComponent(hash.slice(4)));
  return homePage();
}

window.addEventListener('hashchange', route);
route();