import { useEffect, useState } from 'react';

import { apiRequest } from '../api.js';
import { useI18n } from '../i18n.js';
import { studioPath } from '../studio-route.js';
import { ContentScreen } from './ContentScreen.jsx';

export function singletonDestination(collection, collectionMeta, rows = []) {
  if (!collectionMeta?.singleton) return null;
  const primaryKey = collectionMeta.primary_key || 'id';
  const first = rows[0];
  if (first?.[primaryKey] != null) return studioPath.contentRecord(collection, first[primaryKey]);
  return studioPath.contentNew(collection);
}

export function ContentRouteScreen({
  collection,
  collectionLabel,
  collectionMeta,
  route,
  onNavigate,
  onOpenDataModel,
}) {
  const { t } = useI18n();
  const [resolving, setResolving] = useState(Boolean(collectionMeta?.singleton && ['list', 'new'].includes(route?.view)));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!collectionMeta?.singleton || !collection || !['list', 'new'].includes(route?.view)) {
      setResolving(false);
      setError('');
      return undefined;
    }

    let cancelled = false;
    setResolving(true);
    setError('');
    const primaryKey = collectionMeta.primary_key || 'id';
    apiRequest(`/items/${encodeURIComponent(collection)}?fields=${encodeURIComponent(primaryKey)}&limit=1`)
      .then((response) => {
        if (cancelled) return;
        const destination = singletonDestination(collection, collectionMeta, response?.data ?? []);
        if (route.view === 'new' && destination === studioPath.contentNew(collection)) {
          setResolving(false);
          return;
        }
        onNavigate?.(destination, { replace: true });
      })
      .catch((requestError) => {
        if (cancelled) return;
        setError(requestError.message || t('navigation.singletonOpening'));
        setResolving(false);
      });

    return () => { cancelled = true; };
  }, [collection, collectionMeta?.singleton, collectionMeta?.primary_key, route?.view]);

  if (resolving) return <div className="panel"><p className="muted-line">{t('navigation.singletonOpening')}</p></div>;
  if (error) return <div className="error-banner" role="alert">{error}</div>;

  return (
    <ContentScreen
      collection={collection}
      collectionLabel={collectionLabel}
      route={route}
      onNavigate={onNavigate}
      onOpenDataModel={onOpenDataModel}
    />
  );
}
