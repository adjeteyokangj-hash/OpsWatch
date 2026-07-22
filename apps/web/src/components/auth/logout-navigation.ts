export const redirectAfterLogout = (): void => {
  window.location.replace("/login?reason=logged_out");
};
