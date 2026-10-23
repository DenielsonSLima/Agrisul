import type {ImportProfile} from '../types';
export function availableImportProfiles(profiles:ImportProfile[],clientId=''){
 return profiles.filter(profile=>profile.active!==false&&(!clientId||!profile.clientId||profile.clientId===clientId));
}
export function preferredImportProfile(profiles:ImportProfile[],clientId=''){
 const available=availableImportProfiles(profiles,clientId);
 if(clientId)return available.find(profile=>profile.clientId===clientId&&profile.isDefault)??available.find(profile=>!profile.clientId&&profile.isDefault)??available.find(profile=>profile.clientId===clientId)??available[0];
 return available.find(profile=>!profile.clientId&&profile.isDefault)??available.find(profile=>profile.isDefault)??available[0];
}
