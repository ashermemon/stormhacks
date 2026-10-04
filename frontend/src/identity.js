// Who this browser is: a secret token issued by the server, plus the chosen name.
// Stored in localStorage, so the same browser is the same player.
//
// To run several players from one browser (e.g. testing), open the page with
// `?as=<label>`: each label gets its own token and name.
const profile = new URLSearchParams(location.search).get('as');
const key = (field) => `stormhacks.${field}${profile ? `.${profile}` : ''}`;

export const identity = {
  getToken: () => localStorage.getItem(key('token')) || undefined,
  setToken: (token) => localStorage.setItem(key('token'), token),
  getName: () => localStorage.getItem(key('name')) || '',
  setName: (name) => localStorage.setItem(key('name'), name),
};
