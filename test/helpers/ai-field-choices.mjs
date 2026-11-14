export const businessFields = [
  {field:'state',type:'string',interface:'select',options:['Yeni','Tamamlandı']},
  {field:'priority',type:'integer',interface:'select-dropdown',options:{choices:[{value:1,text:'Low'},{value:2,label:'High'}],private_setting:'DO_NOT_EXPOSE'}},
];
export const memberFields = ['id','title','state'];
export const stateChoices = [{value:'Yeni',label:'Yeni'},{value:'Tamamlandı',label:'Tamamlandı'}];
export const priorityChoices = [{value:1,label:'Low'},{value:2,label:'High'}];
