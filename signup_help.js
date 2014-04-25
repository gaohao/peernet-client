var socket = io.connect('http://peernet.herokuapp.com');
  socket.on('connect', function(socket1) { 
  	//alert($( "#uname" ).val());
  
  });


function signup()
{
   socket.emit('userdata',{uname:$( "#uname" ).val() , email:$( "#email" ).val() , password:$( "#password" ).val() });

  socket.on('success', function (data) {
    console.log(data);
    //socket.emit('my other event', { my: 'data' });
   window.location.replace("success.html");
  });
  socket.on('fail', function (data) {
    console.log(data);
   	$('#error-msg').text(data.message+". Plese check again.");
  });
}

