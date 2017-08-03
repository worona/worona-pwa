import { Component } from 'react';
import { combineReducers } from 'redux';
import { connect, Provider } from 'react-redux';
import dynamic from '@worona/next/dynamic';
import { normalize } from 'normalizr';
import request from 'superagent';
import { find } from 'lodash';
import { initStore } from '../core/store';
import reducers from '../core/reducers';
import { settingsSchema } from '../core/schemas';

const packages = [
  {
    namespace: 'generalSettings',
    name: 'general-app-extension-worona',
    DynamicComponent: dynamic(import('../packages/general-app-extension-worona')),
    importFunction: () => import('../packages/general-app-extension-worona'),
    requireFunction: () => eval('require("../packages/general-app-extension-worona")'),
  },
  {
    namespace: 'theme',
    name: 'starter-app-theme-worona',
    DynamicComponent: dynamic(import('../packages/starter-app-theme-worona')),
    importFunction: () => import('../packages/starter-app-theme-worona'),
    requireFunction: () => eval('require("../packages/starter-app-theme-worona")'),
  },
  {
    namespace: 'theme',
    name: 'wp-org-connection-app-extension-worona',
    DynamicComponent: dynamic(import('../packages/wp-org-connection-app-extension-worona')),
    importFunction: () => import('../packages/wp-org-connection-app-extension-worona'),
    requireFunction: () => eval('require("../packages/wp-org-connection-app-extension-worona")'),
  },
];

class Index extends Component {
  constructor(props) {
    super(props);
    // Init the store for the Provider using the initialState from getInitialProps.
    this.store = initStore({
      reducer: combineReducers(reducers),
      initialState: props.initialState,
    });
  }

  static async getInitialProps({ req, serverProps, query }) {
    // Server side rendering.
    if (req) {
      // Retrieve site settings.
      const cdn = process.env.PROD ? 'cdn' : 'precdn';
      const { body } = await request(
        `https://${cdn}.worona.io/api/v1/settings/site/${query.siteId}/app/prod/live`
      );
      const { results, entities: { settings } } = normalize(body, settingsSchema);
      // Populate reducers and create server redux store to pass initialState on SSR.
      Object.keys(settings).forEach(name => {
        const pkg = find(packages, { name });
        if (!pkg) throw new Error(`Package ${name} not installed.`);
        reducers[pkg.namespace] = pkg.requireFunction().default.reducers;
      });
      const store = initStore({ reducer: combineReducers(reducers) });
      return { initialState: store.getState(), settings };
      // Client first rendering.
    } else if (serverProps) {
      // Populate reducers on client (async) for client redux store.
      const start = new Date();
      const reducerPromises = packages.map(
        async ({ namespace, importFunction }) => (await importFunction()).default.reducers
      );
      const packageReducers = await Promise.all(reducerPromises);
      packageReducers.forEach((value, index) => {
        reducers[packages[index].namespace] = value;
      });
      const end = new Date();
      console.log(end - start);
    }
    // Client, rest of the renders.
    return {};
  }

  static runInitialPropsAgain({ serverProps }) {
    return true;
  }

  render() {
    return (
      <Provider store={this.store}>
        <div>
          hola
          {packages.map(({ namespace, DynamicComponent }) => <DynamicComponent key={namespace} />)}
        </div>
      </Provider>
    );
  }
}

export default Index;
