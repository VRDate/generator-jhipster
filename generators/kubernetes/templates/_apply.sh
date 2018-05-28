#!/bin/bash
<%#
 Copyright 2013-2018 the original author or authors from the JHipster project.

 This file is part of the JHipster project, see https://www.jhipster.tech/
 for more information.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
-%>
# Files are ordered in proper order with needed wait for the dependent custom resource definitions to get initialized.
# Usage: bash <%-directoryPath%>apply.sh
<%_ if (istioSupportOpt === 'mi') { _%>
loopDir(){
  for entry in "$1"/*
  do
    kubectl apply -f <(istioctl kube-inject -f ${entry})
  done
}
<%_ } _%>

<%_ if (kubernetesNamespace !== 'default') { _%>
kubectl apply -f <%-directoryPath%>k8s/namespace.yml
<%_ } _%> <%_ if (istioSupportOpt === 'ai') { _%>
kubectl label namespace <%-kubernetesNamespace%> istio-injection=enabled
<%_ } _%> <%_ if (istioSupportOpt === 'mi') { _%>
<%_ if (serviceDiscoveryType === 'eureka' || serviceDiscoveryType === 'consul') { _%>
loopDir "<%-directoryPath%>k8s/registry"
<%_ } _%> <%_ appConfigs.forEach((appConfig, index) =>  { _%>
loopDir "<%-directoryPath%>k8s/<%- appConfig.baseName.toLowerCase() %>"
<%_ }) _%>
<%_ } else {_%>
<%_ if (serviceDiscoveryType === 'eureka' || serviceDiscoveryType === 'consul') { _%>
kubectl apply -f <%-directoryPath%>k8s/registry/
<%_ } _%> <%_ appConfigs.forEach((appConfig, index) =>  { _%>
kubectl apply -f <%-directoryPath%>k8s/<%- appConfig.baseName.toLowerCase() %>/
<%_ }) _%> <%_ } _%> <%_ if (useKafka === true) { _%>
kubectl apply -f <%-directoryPath%>k8s/messagebroker/
<%_ } _%> <%_ if (monitoring === 'elk') { _%>
kubectl apply -f <%-directoryPath%>k8s/console/
<%_ } _%> <%_ if (monitoring === 'prometheus') { _%>
kubectl apply -f <%-directoryPath%>k8s/monitoring/jhipster-prometheus-crd.yml
until [ $(kubectl get crd prometheuses.monitoring.coreos.com 2>>/dev/null | wc -l) -ge 2 ]; do
    echo "Waiting for the custom resource prometheus operator to get initialised";
    sleep 5;
done
kubectl apply -f <%-directoryPath%>k8s/monitoring/jhipster-prometheus-cr.yml
kubectl apply -f <%-directoryPath%>k8s/monitoring/jhipster-grafana.yml
kubectl apply -f <%-directoryPath%>k8s/monitoring/jhipster-grafana-dashboard.yml
<%_ } _%>
