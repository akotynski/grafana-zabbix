import _ from 'lodash';
import Q from "q";
import {Datasource} from "../module";
import {zabbixTemplateFormat} from "../datasource";

describe('ZabbixDatasource', () => {
  let ctx = {};

  beforeEach(() => {
    ctx.instanceSettings = {
      jsonData: {
        alerting: true,
        username: 'zabbix',
        password: 'zabbix',
        trends: true,
        trendsFrom: '14d',
        trendsRange: '7d',
        dbConnection: {
          enabled: false
        }
      }
    };
    ctx.templateSrv = {};
    ctx.alertSrv = {};
    ctx.dashboardSrv = {};
    ctx.zabbixAlertingSrv = {};
    ctx.zabbix = () => {};

    ctx.ds = new Datasource(ctx.instanceSettings, ctx.templateSrv, ctx.alertSrv, ctx.dashboardSrv, ctx.zabbixAlertingSrv, ctx.zabbix);
  });

  describe('When querying data', () => {
    beforeEach(() => {
      ctx.ds.replaceTemplateVars = (str) => str;
      ctx.ds.alertQuery = () => Q.when([]);
    });

    ctx.options = {
      targets: [
        {
          group: {filter: ""},
          host: {filter: ""},
          application: {filter: ""},
          item: {filter: ""}
        }
      ],
      range: {from: 'now-7d', to: 'now'}
    };

    it('should return an empty array when no targets are set', (done) => {
      let options = {
        targets: [],
        range: {from: 'now-6h', to: 'now'}
      };
      ctx.ds.query(options).then(result => {
        expect(result.data.length).toBe(0);
        done();
      });
    });

    it('should use trends if it enabled and time more than trendsFrom', (done) => {
      let ranges = ['now-7d', 'now-168h', 'now-1M', 'now-1y'];

      _.forEach(ranges, range => {
        ctx.options.range.from = range;
        ctx.ds.queryNumericData = jest.fn();
        ctx.ds.query(ctx.options);

        // Check that useTrends options is true
        let callArgs = ctx.ds.queryNumericData.mock.calls[0];
        expect(callArgs[2]).toBe(true);
        ctx.ds.queryNumericData.mockClear();
      });

      done();
    });

    it('shouldnt use trends if it enabled and time less than trendsFrom', (done) => {
      let ranges = ['now-6d', 'now-167h', 'now-1h', 'now-30m', 'now-30s'];

      _.forEach(ranges, range => {
        ctx.options.range.from = range;
        ctx.ds.queryNumericData = jest.fn();
        ctx.ds.query(ctx.options);

        // Check that useTrends options is false
        let callArgs = ctx.ds.queryNumericData.mock.calls[0];
        expect(callArgs[2]).toBe(false);
        ctx.ds.queryNumericData.mockClear();
      });
      done();
    });

  });

  describe('When replacing template variables', () => {

    function testReplacingVariable(target, varValue, expectedResult, done) {
      ctx.ds.templateSrv.replace = () => {
        return zabbixTemplateFormat(varValue);
      };

      let result = ctx.ds.replaceTemplateVars(target);
      expect(result).toBe(expectedResult);
      done();
    }

    /*
     * Alphanumerics, spaces, dots, dashes and underscores
     * are allowed in Zabbix host name.
     * 'AaBbCc0123 .-_'
     */
    it('should return properly escaped regex', (done) => {
      let target = '$host';
      let template_var_value = 'AaBbCc0123 .-_';
      let expected_result = '/^AaBbCc0123 \\.-_$/';

      testReplacingVariable(target, template_var_value, expected_result, done);
    });

    /*
     * Single-value variable
     * $host = backend01
     * $host => /^backend01|backend01$/
     */
    it('should return proper regex for single value', (done) => {
      let target = '$host';
      let template_var_value = 'backend01';
      let expected_result = '/^backend01$/';

      testReplacingVariable(target, template_var_value, expected_result, done);
    });

    /*
     * Multi-value variable
     * $host = [backend01, backend02]
     * $host => /^(backend01|backend01)$/
     */
    it('should return proper regex for multi-value', (done) => {
      let target = '$host';
      let template_var_value = ['backend01', 'backend02'];
      let expected_result = '/^(backend01|backend02)$/';

      testReplacingVariable(target, template_var_value, expected_result, done);
    });
  });

  describe('When invoking metricFindQuery()', () => {
    beforeEach(() => {
      ctx.ds.replaceTemplateVars = (str) => str;
      ctx.ds.zabbix = {
        getGroups: jest.fn().mockReturnValue(Q.when([])),
        getHosts: jest.fn().mockReturnValue(Q.when([])),
        getApps: jest.fn().mockReturnValue(Q.when([])),
        getItems: jest.fn().mockReturnValue(Q.when([]))
      };
    });

    it('should return groups', (done) => {
      const tests = [
        {query: '*',        expect: '/.*/'},
        {query: '',         expect: ''},
        {query: 'Backend',  expect: 'Backend'},
        {query: 'Back*',    expect: 'Back*'},
      ];

      for (const test of tests) {
        ctx.ds.metricFindQuery(test.query);
        expect(ctx.ds.zabbix.getGroups).toBeCalledWith(test.expect);
        ctx.ds.zabbix.getGroups.mockClear();
      }
      done();
    });

    it('should return hosts', (done) => {
      const tests = [
        {query: '*.*',       expect: ['/.*/', '/.*/']},
        {query: '.',         expect: ['', '']},
        {query: 'Backend.*', expect: ['Backend', '/.*/']},
        {query: 'Back*.',    expect: ['Back*', '']},
      ];

      for (const test of tests) {
        ctx.ds.metricFindQuery(test.query);
        expect(ctx.ds.zabbix.getHosts).toBeCalledWith(test.expect[0], test.expect[1]);
        ctx.ds.zabbix.getHosts.mockClear();
      }
      done();
    });

    it('should return applications', (done) => {
      const tests = [
        {query: '*.*.*',               expect: ['/.*/', '/.*/', '/.*/']},
        {query: '.*.',                 expect: ['', '/.*/', '']},
        {query: 'Backend.backend01.*', expect: ['Backend', 'backend01', '/.*/']},
        {query: 'Back*.*.',            expect: ['Back*', '/.*/', '']}
      ];

      for (const test of tests) {
        ctx.ds.metricFindQuery(test.query);
        expect(ctx.ds.zabbix.getApps).toBeCalledWith(test.expect[0], test.expect[1], test.expect[2]);
        ctx.ds.zabbix.getApps.mockClear();
      }
      done();
    });

    it('should return items', (done) => {
      const tests = [
        {query: '*.*.*.*',               expect: ['/.*/', '/.*/', '', '/.*/']},
        {query: '.*.*.*',                expect: ['', '/.*/', '', '/.*/']},
        {query: 'Backend.backend01.*.*', expect: ['Backend', 'backend01', '', '/.*/']},
        {query: 'Back*.*.cpu.*',         expect: ['Back*', '/.*/', 'cpu', '/.*/']}
      ];

      for (const test of tests) {
        ctx.ds.metricFindQuery(test.query);
        expect(ctx.ds.zabbix.getItems)
          .toBeCalledWith(test.expect[0], test.expect[1], test.expect[2], test.expect[3]);
        ctx.ds.zabbix.getItems.mockClear();
      }
      done();
    });

    it('should invoke method with proper arguments', (done) => {
      let query = '*.*';

      ctx.ds.metricFindQuery(query);
      expect(ctx.ds.zabbix.getHosts).toBeCalledWith('/.*/', '/.*/');
      done();
    });
  });

  describe('When querying alerts', () => {
    let options = {};

    beforeEach(() => {
      ctx.ds.replaceTemplateVars = (str) => str;

      let targetItems = [{
        "itemid": "1",
        "name": "test item",
        "key_": "test.key",
        "value_type": "3",
        "hostid": "10631",
        "status": "0",
        "state": "0",
        "hosts": [{"hostid": "10631", "name": "Test host"}],
        "item": "Test item"
      }];
      ctx.ds.zabbix.getItemsFromTarget = () => Promise.resolve(targetItems);

      options = {
        "panelId": 10,
        "targets": [{
          "application": {"filter": ""},
          "group": {"filter": "Test group"},
          "host": {"filter": "Test host"},
          "item": {"filter": "Test item"},
        }]
      };
    });

    it('should return threshold when comparative symbol is `less than`', () => {

      let itemTriggers = [{
        "triggerid": "15383",
        "priority": "4",
        "expression": "{15915}<100",
      }];

      ctx.ds.zabbix.getAlerts = () => Promise.resolve(itemTriggers);

      return ctx.ds.alertQuery(options)
        .then(resp => {
          expect(resp.thresholds).toHaveLength(1);
          expect(resp.thresholds[0]).toBe(100);
          return resp;
        });
    });

    it('should return threshold when comparative symbol is `less than or equal`', () => {

      let itemTriggers = [{
        "triggerid": "15383",
        "priority": "4",
        "expression": "{15915}<=100",
      }];

      ctx.ds.zabbix.getAlerts = () => Promise.resolve(itemTriggers);

      return ctx.ds.alertQuery(options)
        .then(resp => {
          expect(resp.thresholds.length).toBe(1);
          expect(resp.thresholds[0]).toBe(100);
          return resp;
        });
    });

    it('should return threshold when comparative symbol is `greater than or equal`', () => {

      let itemTriggers = [{
        "triggerid": "15383",
        "priority": "4",
        "expression": "{15915}>=30",
      }];

      ctx.ds.zabbix.getAlerts = () => Promise.resolve(itemTriggers);

      return ctx.ds.alertQuery(options)
        .then(resp => {
          expect(resp.thresholds.length).toBe(1);
          expect(resp.thresholds[0]).toBe(30);
          return resp;
        });
    });

    it('should return threshold when comparative symbol is `equal`', () => {

      let itemTriggers = [{
        "triggerid": "15383",
        "priority": "4",
        "expression": "{15915}=50",
      }];

      ctx.ds.zabbix.getAlerts = () => Promise.resolve(itemTriggers);

      return ctx.ds.alertQuery(options)
        .then(resp => {
          expect(resp.thresholds.length).toBe(1);
          expect(resp.thresholds[0]).toBe(50);
          return resp;
        });
    });
  });
});
