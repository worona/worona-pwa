import React from 'react';
import { setStatic, compose } from 'recompose';
import * as actions from './actions';
import * as types from './types';
import reducers from './reducers';

const Packages = () => null;

export default compose(
  setStatic('actions', actions),
  setStatic('types', types),
  setStatic('reducers', reducers),
)(Packages);
