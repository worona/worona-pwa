/* eslint-disable array-callback-return */
import React, { Component } from 'react';
import { combineReducers } from 'redux';
import PropTypes from 'prop-types';
import { Provider } from 'react-redux';
import { normalize } from 'normalizr';
import request from 'superagent';
import worona, { addPackage } from 'worona-deps';
import promiseProps from 'promise-props';
import initStore from '../core/store';
import reducers from '../core/reducers';
import clientSagas from '../core/sagas.client';
import { settingsSchema } from '../core/schemas';
import buildModule from '../core/build';
import routerModule from '../core/router';
import settingsModule from '../core/settings';
import App, { packages } from '../core/packages';

worona.publicPath = process.env.PUBLIC_PATH;

addPackage({ namespace: 'build', module: buildModule });
addPackage({ namespace: 'router', module: routerModule });
addPackage({ namespace: 'settings', module: settingsModule });

const getModules = async (activatedPackages, functionName = 'importPackage') => {
  // Get (and start) all the promises.
  const importPromises = activatedPackages
    .map(name => {
      if (!packages[name]) throw new Error(`Worona Package ${name} failed (${functionName}).`);
      return packages[name][functionName]
        ? { name, importPackage: packages[name][functionName] }
        : false;
    })
    .filter(item => item)
    .reduce((obj, { name, importPackage }) => ({ ...obj, [name]: importPackage() }), {});
  // Wait until all the promises have been resolved.
  const packageDefaultModules = await promiseProps(importPromises);
  // Iterate internally to get rid of 'default'.
  const packageModules = Object.entries(packageDefaultModules).reduce(
    (obj, [name, module]) => ({ ...obj, [name]: module.default }),
    {}
  );
  return packageModules;
};

class Index extends Component {
  static propTypes = {
    initialState: PropTypes.shape(),
    isServer: PropTypes.bool.isRequired,
  }

  static defaultProps = {
    initialState: {}
  }

  static async getInitialProps(params) {
    // Server side rendering.
    if (params.req) {
      // Get all the core server sagas.
      const serverSagas = (await import('../core/sagas.server')).default;
      // Retrieve and normalize site settings.
      const cdn = process.env.PROD ? 'cdn' : 'precdn';
      const { body } = await request(
        `https://${cdn}.worona.io/api/v1/settings/site/${params.query.siteId}/app/prod/live`
      );
      const { entities: { settings } } = normalize(body, settingsSchema);

      // Extract activated packages array from settings.
      const activatedPackages = Object.values(settings)
        .filter(pkg => pkg.woronaInfo.namespace !== 'generalSite')
        .reduce((obj, pkg) => ({ ...obj, [pkg.woronaInfo.namespace]: pkg.woronaInfo.name }), {});

      // Wait until all the modules have been loaded, then add the reducers to the system.
      const packageModules = await getModules(Object.values(activatedPackages), 'requirePackage');
      Object.entries(packageModules).map(([name, module]) => {
        if (module.reducers) reducers[packages[name].namespace] = module.reducers;
        addPackage({ namespace: packages[name].namespace, module });
      });

      // Wait until all the server sagas have been loaded, then add the server sagas to the system.
      const packageServerSagas = await getModules(
        Object.values(activatedPackages),
        'importServerSagas'
      );
      Object.entries(packageServerSagas).map(([name, serverSaga]) => {
        if (serverSaga) serverSagas[name] = serverSaga;
      });

      // Create server redux store to pass initialState on SSR.
      const store = initStore({ reducer: combineReducers(reducers) });

      // Add settings to the state.
      store.dispatch(buildModule.actions.serverStarted());
      store.dispatch(settingsModule.actions.siteIdUpdated({ siteId: params.query.siteId }));
      const { query, pathname, asPath } = params;
      store.dispatch(routerModule.actions.routeChangeSucceed({ query, pathname, asPath }));
      store.dispatch(buildModule.actions.activatedPackagesUpdated({ packages: activatedPackages }));
      store.dispatch(settingsModule.actions.settingsUpdated({ settings }));

      // Run and wait until all the server sagas have run.
      const startSagas = new Date();
      const sagaPromises = Object.values(serverSagas).map(saga => store.runSaga(saga, params).done);
      store.dispatch(buildModule.actions.serverSagasInitialized());
      await Promise.all(sagaPromises);
      store.dispatch(
        buildModule.actions.serverFinished({ timeToRunSagas: new Date() - startSagas })
      );

      // Return server props.
      return { initialState: store.getState(), activatedPackages, isServer: true };

      // Client first rendering.
    } else if (params.serverProps) {
      // Populate reducers and sagas on client (async) for client redux store.
      const packageModules = await getModules(Object.values(params.serverProps.activatedPackages));
      Object.entries(packageModules).map(([name, module]) => {
        if (module.reducers) reducers[packages[name].namespace] = module.reducers;
        if (module.sagas) clientSagas[packages[name].namespace] = module.sagas;
        addPackage({ namespace: packages[name].namespace, module });
      });
    }

    // Client, rest of the renders.
    return { isServer: false };
  }

  static runInitialPropsAgain() {
    return true;
  }

  constructor(props) {
    super(props);
    // Init the store for the Provider using the initialState from getInitialProps.
    this.store = initStore({
      reducer: combineReducers(reducers),
      initialState: props.initialState,
      sagas: clientSagas,
    });
  }

  componentDidMount() {
    if (!this.props.isServer)
      this.store.dispatch(buildModule.actions.clientReactRendered());
  }

  render() {
    return (
      <Provider store={this.store}>
        <App />
      </Provider>
    );
  }
}

export default Index;
