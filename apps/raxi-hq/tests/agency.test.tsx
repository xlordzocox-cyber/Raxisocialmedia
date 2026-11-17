import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { AgencyNav, AGENCY_SECTIONS } from '../src/agency/AgencyNav';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

test('agency nav: five sections, the current one is marked', async () => {
  assert.deepEqual(AGENCY_SECTIONS.map((s) => [s.to, s.label]), [['/', 'Agencia'], ['/fototeca', 'Fototeca'], ['/multimedia', 'Archivo'], ['/conexiones', 'Conexiones'], ['/estudio', 'Estudio en vivo']]);
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<MemoryRouter initialEntries={['/fototeca']}><AgencyNav /></MemoryRouter>); });
  const links = r.root.findAllByType('a');
  assert.deepEqual(links.map((a) => a.props.href), ['/', '/fototeca', '/multimedia', '/conexiones', '/estudio']);
  assert.deepEqual(links.filter((a) => a.props['aria-current'] === 'page').map((a) => a.props.href), ['/fototeca']);
  assert.equal(r.root.findByType('nav').props['aria-label'], 'Secciones de la agencia');
});
