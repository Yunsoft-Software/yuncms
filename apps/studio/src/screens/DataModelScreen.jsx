import { DataModelHomeScreen } from './DataModelHomeScreen.jsx';
import { DataModelV2Screen } from './DataModelV2Screen.jsx';

export function DataModelScreen(props) {
  const view = props.route?.view || 'collections';
  if (view === 'collections') return <DataModelHomeScreen {...props} />;
  return <DataModelV2Screen {...props} />;
}
