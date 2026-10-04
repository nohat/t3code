Pod::Spec.new do |s|
  s.name           = 'T3Papercut'
  s.version        = '1.0.0'
  s.summary        = 'Shake-to-report evidence capture for T3 Code mobile.'
  s.description    = 'Catches the shake gesture natively and keeps a report bundle on disk, so a report survives a blocked JavaScript thread.'
  s.author         = 'T3 Tools'
  s.homepage       = 'https://t3tools.com'
  s.platforms      = {
    :ios => '18.0',
  }
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
