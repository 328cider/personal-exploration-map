const FIELD_TEST_VARIANT = "field-test";

module.exports = ({ config }) => {
  const isFieldTest = process.env.APP_VARIANT === FIELD_TEST_VARIANT;

  return {
    ...config,
    name: isFieldTest ? "探索マップ Field Test" : config.name,
    android: {
      ...config.android,
      package: isFieldTest
        ? "com.cider328.personalexplorationmap.fieldtest"
        : config.android?.package,
    },
    extra: {
      ...config.extra,
      buildVariant: isFieldTest ? FIELD_TEST_VARIANT : "default",
    },
  };
};
