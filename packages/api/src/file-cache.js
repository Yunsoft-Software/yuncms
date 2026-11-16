// Public grants still require origin authorization on every reuse. Neither
// a user's token nor a Public role grant is an immutable content capability.
export function fileContentCacheControl(accountability) {
  const publicAccess = accountability?.public === true && !accountability.user
    && accountability.admin !== true && accountability.system !== true;
  return publicAccess ? 'public, no-cache, must-revalidate' : 'private, no-store';
}

export function privateFileContentCache(_req, res, next) {
  res.set('cache-control', fileContentCacheControl());
  res.vary('Authorization');
  res.vary('Cookie');
  next();
}
